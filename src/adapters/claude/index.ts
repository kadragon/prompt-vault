import type { Conversation, Message, Role } from '../../core/conversation';
import type { SidebarConversation } from '../../core/sidebar';
import { ExtractionError } from '../../core/errors';
import { blockToMarkdown, htmlToMarkdown } from '../../core/html-to-markdown';
import type { ConversationAdapter, LoadMoreOptions, OpenConversationOptions } from '../types';
import { matches, matchesProject } from './matches';
import { selectors, TITLE_SUFFIX } from './selectors';

const PROVIDER = 'claude';

// Walk tuning for the virtualized message list. Claude keeps only a window of turn
// nodes in the DOM and RECYCLES them — scrolling to the top dropped the rendered count
// from 16 to 8 while surfacing different turns (verified live 2026-07-25) — so the walk
// steps through the viewport and accumulates, per docs/conventions.md. Turns are already
// client-side (the walk surfaced a contiguous index range without any server round-trip),
// so the per-step delay only has to cover a render frame, not a fetch. It is far shorter
// than the ChatGPT *sidebar* numbers, which pay for `#history` pagination.
const SCROLL_STEP_DELAY_MS = 150;
// Advance half a viewport per step so every region falls inside two consecutive windows
// and each turn is seen at least twice — once to record it, again to upgrade its content
// if the first sighting caught it mid-render.
const WALK_STEP_FRACTION = 0.5;
// Consecutive rounds pinned at an end before it counts as reached, so a single stalled
// frame is not mistaken for the end of the list.
const END_SETTLE_ROUNDS = 2;
// Hard anti-runaway ceiling, far above any real conversation's step count (the primary
// bound is derived from the live scroll height each iteration).
const WALK_ABSOLUTE_MAX_STEPS = 2000;
// A live response can remain at the bottom while it streams for tens of seconds. The
// measured stream marker is the completion signal, so the bottom dwell needs a bound larger
// than the geometry-derived scroll-step count while still refusing an unending stream.
const STREAM_SETTLE_MAX_STEPS = 400;

// Navigation-list tuning. Claude's measured sidebar/project surfaces are client-rendered;
// there is no verified server-paging contract to wait for. The loader therefore walks the
// nearest measured scroll ancestor in viewport-sized steps and stops only after the position
// clamps and the accumulated id set stays unchanged for a few rounds.
// Consecutive polls an opened conversation's fingerprint must stay unchanged before the route
// counts as settled. Only reached when the fingerprint never differed from the outgoing one —
// i.e. two similarly shaped conversations collided — so it costs nothing in the common case.
const OPEN_SETTLE_ROUNDS = 2;
const NAV_SCROLL_STEP_FRACTION = 0.9;
const NAV_STABLE_ROUNDS = 3;
const NAV_ABSOLUTE_MAX_STEPS = 400;
const OPEN_POLL_MS = 150;
const OPEN_TIMEOUT_MS = 15000;

// Set when the project bulk panel first enumerates its measured home table. A project run
// opens several members sequentially; after the first click the table may be replaced by the
// chat route, so the next opener returns through the browser's existing SPA history entry
// before clicking the next verified table anchor.
let activeProjectHomeUrl: string | null = null;

// Claude's own icon-button classes, taken verbatim from its native header Share button
// (verified live 2026-07-25). Only two tokens are dropped, and only because they are wrong
// for THIS button rather than merely unused:
//   - `px-md` — horizontal padding for a *labeled* control; the export buttons are
//     icon-only squares.
//   - `aria-pressed:text-accent` — a toggle-button style; these buttons are not toggles and
//     never carry `aria-pressed`.
// The `disabled:` variants are deliberately KEPT: `runExport` (src/content/mount.ts) sets
// `disabled` on every button for the duration of an export, and on Claude that export is a
// two-pass scroll walk lasting seconds to minutes — these tokens are the only in-flight
// feedback the user gets. The cursor token is kept for the same reason: under Claude's
// `cds-reset` it is what restores an interactive cursor.
//
// Owned by the adapter (not the content layer) to keep provider CSS knowledge here; if
// Claude renames these tokens the buttons degrade to unstyled-but-functional.
const TOOLBAR_BUTTON_CLASS =
  'cds-reset group/btn relative isolate inline-flex shrink-0 items-center justify-center ' +
  'gap-1.5 whitespace-nowrap select-none cursor-[var(--cds-cursor-interactive)] ' +
  'aria-disabled:cursor-default data-[disabled]:cursor-default border-0 outline-none ' +
  'focus-visible:outline-hidden rounded h-control font-sans text-body font-medium ' +
  '[&:disabled:not([aria-busy])]:opacity-50 disabled:pointer-events-none ' +
  'transition-shadow duration-fast focus-visible:shadow-focus text-primary';

/**
 * Claude adapter. Optional navigation members are limited to the measured sidebar and
 * Project-home DOM surfaces. The content layer gates each shared control on the paired
 * members being present, so an unmeasured track stays absent rather than advertising a
 * button it cannot service.
 */
export const claudeAdapter: ConversationAdapter = {
  provider: PROVIDER,
  matches,
  extract,
  toolbarMount,
  toolbarButtonClass: TOOLBAR_BUTTON_CLASS,
  toolbarAnchor,
  listConversations,
  openConversation,
  loadMoreConversations,
  matchesProject,
  listProjectConversations,
  openProjectConversation,
  openProjectHome,
  projectToolbarMount,
};

/**
 * The header action bar holding Claude's native Share control — the injection point for
 * the export buttons. All Claude DOM knowledge lives in this adapter
 * (docs/conventions.md), so the content layer asks for the mount point instead of
 * hardcoding a selector. Null when the header has not rendered yet or the markup
 * changed; the caller then falls back to a non-overlapping overlay.
 */
function toolbarMount(root: ParentNode = document): Element | null {
  return root.querySelector(selectors.headerActions);
}

/**
 * The native Share button — the export buttons are placed immediately to its left,
 * beside it rather than replacing it. Null when Share has not rendered; the content
 * layer then mounts at the front of the header bar.
 */
function toolbarAnchor(root: ParentNode = document): Element | null {
  return root.querySelector(selectors.shareButton);
}

/**
 * Enumerate the measured recent-chat links in Claude's persistent sidebar. The map is keyed
 * by the stable `/chat/<id>` path so duplicate anchors (for example an active row rendered
 * twice during a transition) never create duplicate checklist entries.
 */
function listConversations(root: ParentNode = document): SidebarConversation[] {
  const sidebar = resolveSidebar(root);
  if (!sidebar) return [];
  return collectNavigationConversations(
    sidebar.querySelectorAll(selectors.sidebarConversationLink),
    documentOrigin(root),
    'sidebar',
  );
}

/**
 * Read a row's out-of-turn markers, letting only a CONVERSATION row fail the export.
 *
 * Both marker readers throw on malformed markup, and both scan surfaces where `root` is the
 * whole live document — `data-index` is a generic virtualizer attribute, not a message-list
 * marker. Ungated, an artifact-shaped node outside the message list (Claude's artifact side
 * panel, any other indexed widget) would abort an otherwise working export, which is exactly
 * what the `messageArticle` gate below the marker scan was written to prevent. Gating the
 * FAILURE rather than the scan keeps that protection without narrowing what is read:
 * `messageArticle` was measured on every indexed message row (112/112 across four
 * conversations, including the attachment-only row).
 */
function readRowMarkers(el: Element): { artifact: string; files: string } | null {
  try {
    return { artifact: artifactMarkers(el), files: attachmentMarkers(el) };
  } catch (error) {
    if (el.querySelector(selectors.messageArticle)) throw error;
    return null;
  }
}

/**
 * The aside that actually holds the recent-chat links. Claude localizes the aside's
 * `aria-label`, so the label is never matched; the anchors it contains are the
 * locale-independent half of the same 2026-08-09 measurement. An aside without any chat
 * link is a legitimately empty list, so the last aside is returned as the surface to walk
 * only when no aside carries links — the caller then simply enumerates nothing.
 */
function resolveSidebar(root: ParentNode = document): Element | null {
  const asides = Array.from(root.querySelectorAll(selectors.sidebar));
  return asides.find((aside) => aside.querySelector(selectors.sidebarConversationLink)) ?? asides.at(-1) ?? null;
}

/**
 * The `<main>` table that holds project conversations. A `/chat/<id>` page can render an
 * assistant markdown table inside `<main>`, and a project home may render knowledge/file
 * tables of its own, so the chat anchors — not document order — decide which table is the
 * conversation list. The first table is still returned when none carries an anchor, so a
 * project list whose rows lost their links stays a visible failure instead of an empty list.
 */
function resolveProjectTable(root: ParentNode = document): Element | null {
  const tables = Array.from(root.querySelectorAll(selectors.projectTable));
  return tables.find((table) => table.querySelector(selectors.projectConversationLink)) ?? tables[0] ?? null;
}

/**
 * Enumerate the measured Project-home table. Every observed row had one chat anchor in its
 * only cell; a row without one is a visible structural failure rather than a silently
 * shortened project list. No load-more member is supplied for this track because paging was
 * not observed live.
 */
function listProjectConversations(root: ParentNode = document): SidebarConversation[] {
  const pageUrl = ownerDocument(root)?.defaultView?.location?.href ?? '';
  if (pageUrl && matchesProject(pageUrl)) activeProjectHomeUrl = pageUrl;
  const table = resolveProjectTable(root);
  if (!table) return [];

  const rows = Array.from(table.querySelectorAll(selectors.projectRow));
  const links: Element[] = [];
  for (const row of rows) {
    const rowLinks = Array.from(row.querySelectorAll(selectors.projectConversationLink));
    if (rowLinks.length !== 1) {
      throw new ExtractionError(
        'Could not read the Claude project conversation list: a table row did not contain exactly one ' +
          'conversation link. Claude’s markup may have changed — please report this.',
      );
    }
    links.push(rowLinks[0]);
  }
  return collectNavigationConversations(links, documentOrigin(root), 'project');
}

/**
 * Mount the project trigger beside the measured table. Returning its parent keeps the
 * generic content layer from inserting a non-table `<div>` into `<tbody>`.
 */
function projectToolbarMount(root: ParentNode = document): Element | null {
  return resolveProjectTable(root)?.parentElement ?? null;
}

/** The human label carried by a measured navigation anchor. */
function navigationTitle(anchor: Element): string {
  return (anchor.getAttribute('aria-label') ?? anchor.textContent ?? '').trim();
}

/**
 * Fold measured navigation anchors into an ordered id map. Invalid hrefs or nameless links
 * reject the operation so the bulk panel cannot present a plausible but incomplete list.
 */
function collectNavigationConversations(
  links: Iterable<Element>,
  origin: string,
  surface: 'sidebar' | 'project',
): SidebarConversation[] {
  const acc = new Map<string, SidebarConversation>();
  for (const anchor of links) {
    const href = anchor.getAttribute('href');
    const resolved = href ? resolveConversationHref(href, origin) : null;
    const title = navigationTitle(anchor);
    if (!resolved || !title) {
      throw new ExtractionError(
        `Could not read a Claude ${surface} conversation link: its URL or title is missing. ` +
          'Claude’s markup may have changed — please report this.',
      );
    }
    if (!acc.has(resolved.id)) acc.set(resolved.id, { id: resolved.id, title, url: resolved.url });
  }
  return [...acc.values()];
}

/** Split a measured Claude conversation href into its stable id and canonical absolute URL. */
function resolveConversationHref(href: string, origin: string): { id: string; url: string } | null {
  try {
    const parsed = new URL(href, origin);
    const match = parsed.pathname.match(/^\/chat\/([^/]+)\/?$/);
    if (!match) return null;
    const id = match[1];
    return { id, url: `${origin}/chat/${id}` };
  } catch {
    return null;
  }
}

function documentOrigin(root: ParentNode): string {
  const origin = ownerDocument(root)?.defaultView?.location?.origin;
  return origin && origin !== 'null' ? origin : 'https://claude.ai';
}

/**
 * Open a selected sidebar conversation in place and wait for both the target route and a
 * changed rendered turn signature. Clicking the verified anchor keeps the shared bulk panel
 * alive across Claude's SPA navigation; assigning `location` would reload it away.
 */
async function openConversation(url: string, opts: OpenConversationOptions = {}): Promise<void> {
  const { pollMs = OPEN_POLL_MS, timeoutMs = OPEN_TIMEOUT_MS } = opts;
  const target = resolveConversationHref(url, location.origin);
  if (!target) {
    throw new ExtractionError('Could not open a selected Claude conversation: its URL is malformed. It was skipped.');
  }

  if (location.pathname === `/chat/${target.id}` && hasRenderedMessages()) return;

  const anchor = findSidebarAnchor(target.id);
  if (!anchor) {
    throw new ExtractionError(
      'Could not open a selected Claude conversation: its sidebar link was not found. ' +
        'The recent-chat list may need scrolling into view. It was skipped.',
    );
  }

  const beforeSignature = messageSignature();
  anchor.click();
  if (await waitForOpenedConversation(target.id, beforeSignature, pollMs, timeoutMs)) return;
  throw new ExtractionError(
    'Timed out opening a selected Claude conversation. It may be loading slowly; it was skipped.',
  );
}

/**
 * Wait for the clicked route to render its own turns.
 *
 * A changed `messageSignature()` is the primary proof that the outgoing conversation was
 * replaced, but the signature carries no per-conversation identity — only the row indices,
 * the turn count and two text LENGTHS — so two similarly shaped chats produce the same
 * string and the change can never be observed. Settling on a signature that stayed IDENTICAL
 * across consecutive polls covers that collision: the route already matches and the rendered
 * list has stopped moving, which is as much as this fingerprint can attest. Without it a
 * correctly loaded conversation is reported as a timeout and skipped from the batch.
 */
async function waitForOpenedConversation(
  id: string,
  beforeSignature: string,
  pollMs: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let previous: string | null = null;
  let stable = 0;
  while (Date.now() < deadline) {
    await delay(pollMs);
    if (location.pathname !== `/chat/${id}` || !hasRenderedMessages()) {
      previous = null;
      stable = 0;
      continue;
    }
    const signature = messageSignature();
    if (signature !== beforeSignature) return true;
    stable = signature === previous ? stable + 1 : 0;
    previous = signature;
    if (stable >= OPEN_SETTLE_ROUNDS) return true;
  }
  return false;
}

function findSidebarAnchor(id: string): HTMLAnchorElement | null {
  const sidebar = resolveSidebar(document);
  if (!sidebar) return null;
  for (const anchor of sidebar.querySelectorAll<HTMLAnchorElement>(selectors.sidebarConversationLink)) {
    const href = anchor.getAttribute('href');
    const resolved = href ? resolveConversationHref(href, location.origin) : null;
    if (resolved?.id === id) return anchor;
  }
  return null;
}

/** Open a Project member through the same measured `/chat/<id>` route and wait for its render. */
async function openProjectConversation(url: string, opts: OpenConversationOptions = {}): Promise<void> {
  const { pollMs = OPEN_POLL_MS, timeoutMs = OPEN_TIMEOUT_MS } = opts;
  const target = resolveConversationHref(url, location.origin);
  if (!target) {
    throw new ExtractionError('Could not open a selected Claude project conversation: its URL is malformed. It was skipped.');
  }

  if (location.pathname === `/chat/${target.id}` && hasRenderedMessages()) return;

  // The ROUTE decides whether the project home still has to be restored. A rendered table is
  // not proof of it: an assistant markdown table also matches `main table` from a `/chat/<id>`
  // page, which would skip the return and fail every remaining member of the batch.
  if (!matchesProject(currentPageUrl())) {
    await returnToProjectHome(activeProjectHomeUrl, pollMs, timeoutMs);
  }

  const anchor = findProjectConversationAnchor(target.id);
  if (!anchor) {
    throw new ExtractionError(
      'Could not open a selected Claude project conversation: its table link was not found. ' +
        'The project list may need to render first. It was skipped.',
    );
  }

  const beforeSignature = messageSignature();
  anchor.click();
  if (await waitForOpenedConversation(target.id, beforeSignature, pollMs, timeoutMs)) return;
  throw new ExtractionError(
    'Timed out opening a selected Claude project conversation. It may be loading slowly; it was skipped.',
  );
}

function findProjectConversationAnchor(id: string): HTMLAnchorElement | null {
  const table = resolveProjectTable(document);
  if (!table) return null;
  for (const anchor of table.querySelectorAll<HTMLAnchorElement>(selectors.projectConversationLink)) {
    const href = anchor.getAttribute('href');
    const resolved = href ? resolveConversationHref(href, location.origin) : null;
    if (resolved?.id === id) return anchor;
  }
  return null;
}

/** Return to the cached measured project home before opening another project member. */
async function returnToProjectHome(homeUrl: string | null, pollMs: number, timeoutMs: number): Promise<void> {
  if (!homeUrl) {
    throw new ExtractionError(
      'Could not return to the Claude project home: no measured project-home URL is available. It was skipped.',
    );
  }
  const homePath = new URL(homeUrl, location.origin).pathname;
  // Only navigate when the page actually left the project home. Firing `back()` while already
  // there pops to the PREVIOUS entry — a `/chat/<id>` route — and the wait below would then
  // poll for a home the call itself just abandoned. A home whose table is still hydrating only
  // needs waiting out.
  if (currentPageUrlPath() !== homePath) {
    const historyObject = ownerDocument(document)?.defaultView?.history ?? globalThis.history;
    if (!historyObject?.back) {
      throw new ExtractionError('Could not return to the Claude project home: browser history is unavailable. It was skipped.');
    }
    historyObject.back();
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(pollMs);
    if (currentPageUrlPath() === homePath && resolveProjectTable(document)) {
      return;
    }
  }
  throw new ExtractionError('Timed out returning to the Claude project home. It may be loading slowly; it was skipped.');
}

/** Optional project-track return hook used by the generic bulk driver after the batch. */
async function openProjectHome(homeUrl: string, opts: OpenConversationOptions = {}): Promise<void> {
  const { pollMs = OPEN_POLL_MS, timeoutMs = OPEN_TIMEOUT_MS } = opts;
  const targetPath = new URL(homeUrl, location.origin).pathname;
  if (location.pathname === targetPath && resolveProjectTable(document)) return;
  await returnToProjectHome(homeUrl, pollMs, timeoutMs);
  if (location.pathname !== targetPath) {
    throw new ExtractionError('Returned to a different Claude project home than the bulk run started from.');
  }
}

function currentPageUrlPath(): string {
  return location.pathname;
}

/** The current route as an absolute URL, so the route gates share `matchesProject`'s parser. */
function currentPageUrl(): string {
  return `${location.origin}${currentPageUrlPath()}`;
}

function hasRenderedMessages(): boolean {
  return document.querySelector(selectors.turn) !== null;
}

/** A compact internal fingerprint used only to distinguish outgoing and incoming SPA content. */
function messageSignature(): string {
  const rows = Array.from(document.querySelectorAll(selectors.turnRow))
    .map((row) => row.getAttribute(selectors.turnIndexAttr) ?? '')
    .join(',');
  const turns = Array.from(document.querySelectorAll(selectors.turn));
  const first = turns[0]?.textContent?.trim() ?? '';
  const last = turns.at(-1)?.textContent?.trim() ?? '';
  return `${rows}:${turns.length}:${first.length}:${last.length}`;
}

/**
 * Load all currently-rendered sidebar rows by stepping the measured recent-chat scroll port.
 * Claude's 2026-08-09 measurement showed no server paging or load-more control, so this
 * loader never claims an unmeasured page-size contract and simply returns the accumulated
 * anchors once the port clamps.
 */
async function loadMoreConversations(
  root: ParentNode = document,
  options: LoadMoreOptions = {},
): Promise<SidebarConversation[]> {
  const sidebar = resolveSidebar(root);
  if (!sidebar) return [];

  // The measured aside is a 953px layout shell; its nested recent-chat port is the actual
  // 564px scroll container. Start from a verified conversation anchor so the nearest scrolling
  // ancestor is selected instead of treating the non-scrolling aside as the whole list.
  const firstLink = sidebar.querySelectorAll(selectors.sidebarConversationLink)[0] ?? null;
  const linkContainer = firstLink ? findScrollableAncestor(firstLink) : null;
  const container =
    linkContainer && hasScrollMetrics(linkContainer) && linkContainer.scrollHeight > linkContainer.clientHeight
      ? linkContainer
      : findScrollableAncestor(sidebar);
  if (container.scrollHeight <= container.clientHeight) return listConversations(root);

  const acc = new Map<string, SidebarConversation>();
  let previousTop = -1;
  let lastCount = -1;
  let stable = 0;
  const stepDelayMs = options.stepDelayMs ?? 150;
  const stableRounds = options.stableRounds ?? NAV_STABLE_ROUNDS;
  const maxSteps = options.maxSteps ?? NAV_ABSOLUTE_MAX_STEPS;

  for (let step = 0; step < maxSteps; step++) {
    const current = collectNavigationConversations(
      sidebar.querySelectorAll(selectors.sidebarConversationLink),
      documentOrigin(root),
      'sidebar',
    );
    for (const conversation of current) {
      if (!acc.has(conversation.id)) acc.set(conversation.id, conversation);
    }
    if (acc.size > lastCount) {
      options.onProgress?.(acc.size);
      stable = 0;
    } else if (container.scrollTop <= previousTop) {
      stable++;
      if (stable >= stableRounds) return [...acc.values()];
    } else {
      stable = 0;
    }
    previousTop = container.scrollTop;
    lastCount = acc.size;
    const advance = Math.max(1, Math.floor(container.clientHeight * NAV_SCROLL_STEP_FRACTION));
    container.scrollTop = Math.min(container.scrollTop + advance, container.scrollHeight);
    await delay(stepDelayMs);
  }

  // `onIncomplete` is the shared contract for a resolved-but-short list (src/adapters/types.ts),
  // and the bulk panel only reads its flag after the promise RESOLVES. Throwing here would
  // discard every conversation the walk did find and replace the partial list with a bare
  // error, so the accumulated set is returned alongside the signal instead.
  options.onIncomplete?.();
  return [...acc.values()];
}

/** Nearest vertically-scrollable ancestor of a measured navigation surface. */
function findScrollableAncestor(el: Element): HTMLElement {
  const view = ownerDocument(el)?.defaultView ?? null;
  let current: Element | null = el;
  while (current) {
    const node = current as HTMLElement;
    if (node.scrollHeight > node.clientHeight) {
      const overflowY = view?.getComputedStyle?.(node)?.overflowY;
      if (!overflowY || overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node;
    }
    current = current.parentElement;
  }
  return el as HTMLElement;
}

function hasScrollMetrics(el: Element): el is HTMLElement {
  const node = el as HTMLElement;
  return Number.isFinite(node.scrollHeight) && Number.isFinite(node.clientHeight);
}

/** Overridable knobs so the walk can be unit-tested without real timers. */
export interface WalkOptions {
  /** Milliseconds to wait after each scroll step before re-reading the DOM. */
  stepDelayMs?: number;
  /** Absolute step cap per pass; exceeding it before reaching the end fails loud. */
  maxSteps?: number;
}

export async function extract(root: ParentNode = document, options: WalkOptions = {}): Promise<Conversation> {
  // On the live page Claude windows the message list: only a handful of turn nodes exist
  // at once and off-screen turns are removed, so a single `querySelectorAll` sees a
  // fraction of the conversation. Collect by walking the viewport. Fixture roots are
  // fully materialized, so they use the one-shot read.
  const messages =
    root === (globalThis as { document?: Document }).document
      ? await collectVirtualizedTurns(root as Document, options)
      : readSnapshot(root);

  if (messages.length === 0) {
    throw new ExtractionError(
      'No messages found on the page. The conversation may not have loaded, or Claude’s ' +
        'markup changed — extraction selectors need updating.',
    );
  }

  return {
    title: deriveTitle(root),
    provider: PROVIDER,
    url: deriveUrl(root),
    messages,
  };
}

/**
 * One-shot read of every turn currently in `root` (fixtures, or a live page with no scroll
 * container). Document order is the conversation order because a turn is either a user bubble
 * or an assistant prose container and the two are disjoint. Fails loud if a turn yielded no
 * content — a silently dropped turn is worse than a visible error (AGENTS.md #4).
 *
 * Rows, not turn nodes, are the unit — the same shape `record()` uses on the walk, and for the
 * same two measured reasons. A row may hold SEVERAL turn nodes (live 2026-07-25: one row of 56
 * held four `.standard-markdown` blocks, all one assistant turn), which are joined rather than
 * exported as separate messages. And a row may hold NONE: an attachment-only user turn renders
 * no `user-message` node at all, its files sitting in the row beside the action bar. Enumerating
 * turn nodes alone dropped that turn with no error whatsoever — such a row contributes no node,
 * so a completeness check counting nodes cannot see it is missing (AGENTS.md #4). A row claimed
 * by nothing is now counted as unreadable here too. Only the counting is shared with the walk,
 * not the wording: `buildMessages` can tell a rendered-but-unreadable row from one that never
 * rendered and says so, while this path has no walk to blame and keeps the one generic message.
 *
 * This path is not fixtures-only: `collectVirtualizedTurns` falls back to it live whenever
 * there is no scroll container or it has zero height (a background tab), which is why it has to
 * meet the same measured row shapes the walk does — and why the row scan carries the same
 * measured scope limit `record()` documents: on 2026-08-01, a full walk of one settled
 * conversation rendered 28 user rows, 27 with no measured attachment shape, and neither tile
 * query matched any of those 27 rows. See docs/live-dom-verification.md → Claude → 2026-08-01.
 */
interface SnapshotEntry {
  role: Role;
  parts: string[];
  claimed: boolean;
  /** Artifact metadata must be attached to a corresponding assistant turn. */
  requiresTurn?: boolean;
}

function readSnapshot(root: ParentNode): Message[] {
  // Rows and turns in ONE query, so the DOM's own document order interleaves them and no
  // position comparison is needed to place an attachment-only row among the turns. A row is
  // returned before the nodes inside it, which is also the order the markers must take: the
  // tile precedes the text body (measured on row 0 — neither contains the other, tile first).
  const all = Array.from(root.querySelectorAll(`${selectors.turnRow}, ${selectors.turn}`));
  const rows = new Set(root.querySelectorAll(selectors.turnRow));
  // Filtered BEFORE anything is accumulated: a dropped thinking block is not a turn that could
  // not be read, and counting it as one would fail every export of a conversation with a block
  // expanded.
  const kept = new Set(dropThinkingBlocks(all.filter((el) => !rows.has(el))));

  const entries: SnapshotEntry[] = [];
  const byRow = new Map<Element, (typeof entries)[number]>();
  // Rows that carried no markers. Whether one is a failure is only knowable after the whole
  // scan: a row is visited BEFORE the turn nodes inside it, so an ordinary prose row looks
  // exactly like an unreadable one at the moment it is reached.
  const markerlessRows: Element[] = [];

  for (const el of all) {
    // Membership decides what each element is, rather than re-testing the selectors: a turn
    // node the thinking filter dropped is in neither set, so it falls through to be ignored —
    // not mistaken for a row and counted as unreadable.
    if (kept.has(el)) {
      const row = el.closest(selectors.turnRow);
      const existing = row ? byRow.get(row) : undefined;
      if (existing) {
        // A turn node settles the role of a row the marker scan attributed to the user, which
        // is how `record()` orders the two as well — there the markers are applied after the
        // turn grouping, so they never override a role read from a node.
        if (!existing.claimed) existing.role = roleOf(el);
        existing.claimed = true;
        existing.parts.push(readTurn(el));
        continue;
      }
      const entry = { role: roleOf(el), parts: [readTurn(el)], claimed: true };
      entries.push(entry);
      // A node with no row ancestor keeps its own entry, exactly as it does today.
      if (row) byRow.set(row, entry);
      continue;
    }
    if (!rows.has(el)) continue;
    // Attachments and artifact cards live OUTSIDE the turn node, so they are read off the row.
    // Artifact cards are assistant-owned in the measured shape and must have a corresponding
    // `.standard-markdown` turn; a malformed card is rejected rather than given invented text.
    const markers = readRowMarkers(el);
    const artifact = markers?.artifact ?? '';
    const files = markers?.files ?? '';
    if (artifact || files) {
      const entry: SnapshotEntry = {
        role: artifact ? 'assistant' : 'user',
        parts: [artifact, files].filter(Boolean),
        claimed: false,
        requiresTurn: Boolean(artifact),
      };
      entries.push(entry);
      byRow.set(el, entry);
    } else if (el.querySelector(selectors.messageArticle)) {
      // Only a row that looks like a conversation row may FAIL the export. `data-index` is a
      // generic virtualizer attribute, not a message-list marker, and on the live fallback
      // `root` is the whole document — so without this gate one stray indexed element anywhere
      // on the page (a sidebar, a menu, any other virtualized widget) would abort an otherwise
      // working export. The walk is not exposed the same way: a stray index only reaches
      // `seenRowIndices`, which selects error wording, and `declaredRowTotal` already reads
      // `messageArticle` and so ignores it.
      //
      // Gating the FAILURE and not the marker scan is deliberate: an over-narrow gate here can
      // only lose a loud error, never invent content, and `messageArticle` was measured on
      // every indexed row — 112/112 across four conversations, explicitly including the
      // attachment-only row that has no `user-message` node, which is the shape this check
      // exists to catch (docs/live-dom-verification.md → Claude → 2026-07-25).
      markerlessRows.push(el);
    }
  }

  const messages: Message[] = [];
  // A row nothing ever claimed — no turn node, no readable tile — is a position this adapter
  // could not read. It has to fail the export rather than go missing from it (AGENTS.md #4).
  let dropped = markerlessRows.filter((row) => !byRow.has(row)).length;
  for (const entry of entries) {
    const content = entry.parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n\n');
    if (content) messages.push({ role: entry.role, content });
    else dropped++;
    if (entry.requiresTurn && !entry.claimed) dropped++;
  }

  if (messages.length > 0 && dropped > 0) {
    throw new ExtractionError(
      'Some conversation turns could not be read (empty or malformed). The conversation may ' +
        'still be loading — wait for it to finish, then try again.',
    );
  }
  return messages;
}

/** A turn accumulated during the walk, keyed by its row's `data-index`. */
interface CollectedTurn {
  role: Role;
  content: string;
  /**
   * Every node this content came from was an extended-thinking block — the row was caught
   * mid-generation, with the reasoning rendered and the answer not yet. Such content is
   * PROVISIONAL: it must lose to the first sighting that carries a real answer, whatever the
   * two lengths are. See the dedupe in `collectVirtualizedTurns`.
   */
  thinkingOnly: boolean;
}

/**
 * Read the whole conversation off the live, recycling message list. The walk goes up to
 * the first turn and back down to the last, recording on every step, and keys each turn by
 * its virtualizer row's `data-index` — the only stable per-turn identity Claude exposes.
 *
 * That index also buys a **completeness oracle** the ChatGPT adapter has never had: the
 * indices of a fully-walked conversation are contiguous, so a hole proves turns were
 * missed and extraction fails loud instead of returning a plausible-looking partial
 * (AGENTS.md #4). Verified live (2026-07-25): a full up-then-down walk produced a
 * contiguous range starting at 0, with zero index→role conflicts and no turn lacking an
 * indexed ancestor.
 *
 * One turn node per row is NOT safe to assume, though — a second live walk the same day
 * over a 56-row conversation measured 54 rows with one turn node, one row with FOUR, and
 * one row with NONE (an attachment-only user turn). Both off-nominal shapes are handled:
 * several nodes in a row are joined, and a row that yields no turn surfaces as a gap that
 * `buildMessages` reports against the rendered-row set. See docs/live-dom-verification.md.
 *
 * Falls back to a one-shot snapshot when there is no scroll container, or when it has zero
 * height (a hidden/background tab never scrolls, so the walk would crawl to the step cap).
 */
export async function collectVirtualizedTurns(doc: Document, options: WalkOptions = {}): Promise<Message[]> {
  const container = doc.querySelector<HTMLElement>(selectors.scrollContainer);
  if (!container || container.clientHeight === 0) return readSnapshot(doc);

  const { stepDelayMs = SCROLL_STEP_DELAY_MS } = options;
  const stepPx = Math.max(1, Math.floor(container.clientHeight * WALK_STEP_FRACTION));

  const turns = new Map<number, CollectedTurn>();
  // Every `data-index` seen on a ROW, whether or not the adapter recognized a turn inside it.
  // A gap in `turns` whose index appears here means the row rendered but held nothing this
  // adapter understands — a different failure from "the walk never reached that turn", and
  // the two deserve different errors (see `buildMessages`).
  const seenRowIndices = new Set<number>();
  let sawUnindexedTurn = false;
  // Smallest row total any row declared during the walk (null until one does). Claude puts
  // the conversation's whole row count on every row, which bounds the TRAILING end — the one
  // thing `data-index` contiguity cannot (see `buildMessages`).
  //
  // The SMALLEST rather than the latest or largest: the total tracks the live list, so a
  // message arriving mid-export raises it, and a walk that already passed the bottom would
  // then be failed for turns that did not exist when the export began. The minimum can only
  // ever under-claim, which costs a missed detection but can never invent one — the safe
  // direction for a check that aborts the whole export. It also costs nothing in the case the
  // check exists for: a walk that stops short sees the true total on every row it did reach,
  // so the minimum IS the true total. And there is no low value to latch onto early — live
  // measurement found rows go from absent straight to the full count, never through a
  // partial one (docs/live-dom-verification.md).
  let declaredTotal: number | null = null;

  const record = (): void => {
    for (const row of Array.from(doc.querySelectorAll(selectors.turnRow))) {
      const index = rowIndex(row);
      if (Number.isInteger(index)) seenRowIndices.add(index);
      const total = declaredRowTotal(row);
      if (total !== null && (declaredTotal === null || total < declaredTotal)) declaredTotal = total;
    }

    // Group this round's sightings by row FIRST, so several turn nodes inside one row are
    // joined rather than fighting each other. Dedupe across rounds happens after: same row
    // seen again → keep whichever round rendered more of it. Collapsing both steps into one
    // map would make a second node in a row look like a re-sighting of the first and drop it
    // silently (AGENTS.md #4). This is not a defensive hypothetical: a 56-row conversation
    // measured live 2026-07-25 held a row with FOUR `.standard-markdown` blocks, all of them
    // one assistant turn's content.
    const round = new Map<number, { role: Role; parts: string[]; thinkingOnly: boolean }>();
    for (const el of dropThinkingBlocks(Array.from(doc.querySelectorAll(selectors.turn)))) {
      const index = rowIndex(el.closest(selectors.turnRow));
      if (!Number.isInteger(index)) {
        // No stable key to dedupe this turn across windows, so it can never be collected
        // reliably. Flag it and fail loud rather than silently omit it (AGENTS.md #4).
        sawUnindexedTurn = true;
        continue;
      }
      // A block survives the filter either because it is the answer, or because it is a
      // thinking block with no answer beside it yet. Only the second kind is provisional, so
      // one non-thinking node anywhere in the row settles it.
      if (!isThinkingBlock(el)) {
        const claimed = round.get(index);
        if (claimed) claimed.thinkingOnly = false;
      }
      const existing = round.get(index);
      if (existing) existing.parts.push(readTurn(el));
      else
        round.set(index, {
          role: roleOf(el),
          parts: [readTurn(el)],
          thinkingOnly: isThinkingBlock(el),
        });
    }

    // Attachments live OUTSIDE the turn node — the tiles sit in the row beside the action bar
    // — so they are read off the row rather than the turn, in both of the shapes a row can
    // take:
    //
    //   - A turn holding ONLY attachments renders no `user-message` node at all (verified live
    //     2026-07-25 on row 50 of a 56-row conversation). Left alone, that row is a position no
    //     turn claims, so `buildMessages` reports it as unreadable and the WHOLE conversation
    //     fails to export.
    //   - A MIXED turn (text plus a file) renders both. This scan used to skip any row the turn
    //     query had already claimed, so the export carried the text and said nothing about the
    //     file — a silent omission rather than a loud failure (AGENTS.md #4).
    //
    // Scanning claimed rows is safe against the worry that BLOCKED it, and that much was
    // measured rather than assumed: a row-level query might sweep up a pasted image inside the
    // turn body and mislabel it as a file. Live 2026-07-29, across four mixed turns and one
    // attachment-only turn (files attached AND an image pasted, txt/pdf/png),
    // `imgsInsideUserMessage` was **0 every time** — every tile is a sibling subtree earlier in
    // the row, never inside `user-message`.
    //
    // What that evidence does NOT cover, stated plainly because the numbers above are easy to
    // over-read: the 2026-07-29 probe had no plain user row. A full walk on 2026-08-01 measured
    // 27 user rows with no measured attachment shape; neither `button > img[alt]` nor
    // `[data-testid="file-thumbnail"] h3` matched any of them. The broad image selector is
    // therefore retained, with the result recorded in docs/live-dom-verification.md rather than
    // narrowed on an unmeasured guess.
    //
    // Markers go FIRST for the same reason: the tile precedes the text body in document order
    // (measured on row 0 — neither contains the other, tile first).
    //
    // Deliberately narrow: `attachmentMarkers` claims a row only if it carries named tiles AND
    // the user-exclusive edit control. A row failing either test is left unclaimed and still
    // fails loud — this recognizes the shapes that were measured rather than guessing at every
    // row the turn query happens to miss.
    //
    // Applied at most ONCE per index per round. This loop iterates row ELEMENTS, so two rows
    // carrying the same `data-index` in one round would each unshift the markers onto the same
    // accumulated turn and yield a duplicated `[File: x]`. Whether Claude's recycling
    // virtualizer ever renders that state is unmeasured; the guard is cheap, and skipping the
    // second row is the only behaviour that cannot invent content. It covers the MARKERS only —
    // the turn-node grouping above joins duplicate-index rows as well, which is left alone
    // because no measurement says what such a pair would contain (AGENTS.md #5).
    const markedIndices = new Set<number>();
    for (const row of Array.from(doc.querySelectorAll(selectors.turnRow))) {
      const index = rowIndex(row);
      if (!Number.isInteger(index)) continue;
      // Validate every matched card before the duplicate-index guard. A second recycled row
      // with malformed metadata is still a visible selector failure, never a reason to skip
      // validation because an earlier row shared its index.
      const rowMarkers = readRowMarkers(row);
      if (!rowMarkers) continue;
      const { artifact, files } = rowMarkers;
      if (!artifact && !files) continue;
      if (markedIndices.has(index)) continue;
      markedIndices.add(index);
      const claimed = round.get(index);
      const markers = [artifact, files].filter(Boolean);
      if (claimed) claimed.parts.unshift(...markers);
      else round.set(index, { role: artifact ? 'assistant' : 'user', parts: markers, thinkingOnly: false });
    }

    for (const [index, { role, parts, thinkingOnly }] of round) {
      const content = parts
        .map((part) => part.trim())
        .filter(Boolean)
        .join('\n\n');
      const seen = turns.get(index);
      if (!seen) {
        turns.set(index, { role, content, thinkingOnly });
      } else if (seen.thinkingOnly && !thinkingOnly && content.trim()) {
        // A sighting that finally caught the answer REPLACES a thinking-only one outright,
        // whatever the two lengths are. Length cannot arbitrate here: the thinking-only
        // sighting holds the whole reasoning, while this one holds the answer with the
        // reasoning filtered out, and an answer is routinely the shorter of the two ("yes").
        // Left to the length rule below, the export would keep Claude's internal reasoning and
        // silently discard the real answer (AGENTS.md #4).
        seen.content = content;
        seen.thinkingOnly = false;
      } else if (seen.thinkingOnly === thinkingOnly && content.length > seen.content.trim().length) {
        // Keep the fullest sighting of this turn, not merely the first non-empty one.
        // Upgrading only from empty would permanently pin a fragment captured while the
        // response was still streaming or hydrating: the walk would then go on to see the
        // finished turn and still export the truncated text — a silent content truncation
        // (AGENTS.md #4). Length is the ordering because a fuller render is a superset of
        // a partial one; a node caught mid-teardown renders shorter and is ignored.
        //
        // Gated on the two sightings being the same KIND, so this only ever compares like with
        // like. The reverse of the branch above — a settled answer meeting a later
        // thinking-only sighting, which happens when a recycled row re-renders mid-stream —
        // falls through both branches and leaves the answer standing.
        seen.content = content;
      }
    }
  };

  // The walk drags the viewport across the whole conversation. Put the user back where they
  // were reading — including on the fail-loud paths, so a failed export does not also cost
  // them their place.
  const restoreScrollTop = container.scrollTop;
  try {
    // Pass 1 — up to the very first turn. Recording on the way means turns above the
    // starting window are captured here rather than waiting for the downward pass.
    const reachedTop = await walk(container, stepDelayMs, options.maxSteps, record, {
      atEnd: (c) => c.scrollTop <= 0,
      step: (c) => {
        c.scrollTop = Math.max(0, c.scrollTop - stepPx);
      },
      stepPx,
    });
    if (!reachedTop) {
      throw new ExtractionError(
        'Timed out scrolling back to the start of the conversation. It may be unusually ' +
          'long; try again, or report if this persists.',
      );
    }

    // Pass 2 — back down to the last turn.
    const reachedBottom = await walk(container, stepDelayMs, options.maxSteps, record, {
      // Scroll position alone cannot distinguish a settled newest response from a response
      // that is still growing at the bottom. The measured marker is authoritative when the
      // newest assistant row is present; absent marker remains non-terminal while it mounts.
      atEnd: (c) => c.scrollTop + c.clientHeight >= c.scrollHeight - 1 && streamState(doc) === 'settled',
      step: (c) => {
        c.scrollTop = Math.min(c.scrollTop + stepPx, c.scrollHeight);
      },
      stepPx,
      requiresStreamCompletion: true,
    });
    if (!reachedBottom) {
      throw new ExtractionError(
        'Timed out waiting for Claude’s streaming state to settle while loading the full conversation. ' +
          'The conversation may still be generating or its markup may have changed — try again, or report if this persists.',
      );
    }

    return buildMessages(turns, seenRowIndices, sawUnindexedTurn, declaredTotal);
  } finally {
    container.scrollTop = restoreScrollTop;
  }
}

/**
 * Step a scroll container toward one end, running `record` on every round (including
 * before the first step and after the last). Resolves true once the end has held for
 * `END_SETTLE_ROUNDS` consecutive rounds, false if the step cap was hit first — the
 * caller decides whether that is fatal. The cap is recomputed from the live scroll height
 * each round so a list that grows as it hydrates is not cut short, while a stuck loop
 * still terminates.
 *
 * Deliberately NOT ended early on the declared row total, even though `collectVirtualizedTurns`
 * now reads one — "every position is filled" is not "every turn is finished". The bottom pass
 * may additionally require the measured `data-is-streaming="false"` marker; a missing marker
 * is pending, never completion. See docs/live-dom-verification.md → "a declared total is an
 * oracle, not a termination condition".
 */
async function walk(
  container: HTMLElement,
  stepDelayMs: number,
  maxSteps: number | undefined,
  record: () => void,
  motion: {
    atEnd: (c: HTMLElement) => boolean;
    step: (c: HTMLElement) => void;
    stepPx: number;
    requiresStreamCompletion?: boolean;
  },
): Promise<boolean> {
  let atEndHits = 0;
  for (let step = 0; ; step++) {
    record();
    if (motion.atEnd(container)) {
      if (++atEndHits >= END_SETTLE_ROUNDS) return true;
    } else {
      atEndHits = 0;
    }
    const geometryCap = Math.ceil(container.scrollHeight / motion.stepPx) + END_SETTLE_ROUNDS + 5;
    const cap = maxSteps ?? Math.max(geometryCap, motion.requiresStreamCompletion ? STREAM_SETTLE_MAX_STEPS : geometryCap);
    if (step >= cap || step >= WALK_ABSOLUTE_MAX_STEPS) return false;
    motion.step(container);
    await delay(stepDelayMs);
  }
}

type StreamState = 'settled' | 'streaming' | 'pending' | 'invalid';

/**
 * Read the measured stream state from the newest rendered assistant row. The marker is a
 * wrapper around `.standard-markdown`, not an attribute on the row itself. A missing marker
 * means the assistant row is still mounting, so it remains pending; it never proves that the
 * response finished. Any rendered `true` marker keeps the walk open, even if an older row also
 * reports `false`.
 */
function streamState(doc: Document): StreamState {
  const allRows = Array.from(doc.querySelectorAll(selectors.turnRow));
  const assistantRows = allRows
    .filter((row) => row.querySelector(selectors.assistantMarkdown) !== null)
    .sort((a, b) => rowIndex(a) - rowIndex(b));
  // The signal belongs only to assistant rows. A bottom window containing user rows alone is
  // a completed prompt boundary, not evidence of a still-generating assistant; an empty
  // message window remains pending so the walk cannot finish before the first row renders.
  if (assistantRows.length === 0) return allRows.length > 0 ? 'settled' : 'pending';

  let newest: StreamState = 'pending';
  for (const row of assistantRows) {
    const marker = row.querySelector(selectors.streamMarker);
    if (!marker) {
      if (row === assistantRows[assistantRows.length - 1]) newest = 'pending';
      continue;
    }
    if (!marker.querySelector(selectors.assistantMarkdown)) return 'invalid';
    const value = marker.getAttribute(selectors.streamStateAttr);
    if (value === 'true') return 'streaming';
    if (value === 'false') {
      if (row === assistantRows[assistantRows.length - 1]) newest = 'settled';
      continue;
    }
    if (row === assistantRows[assistantRows.length - 1]) newest = 'invalid';
  }
  return newest;
}

/** The `data-index` of a virtualizer row as a number, or NaN when it has none. */
function rowIndex(row: Element | null): number {
  const raw = row?.getAttribute(selectors.turnIndexAttr);
  return raw === null || raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
}

/**
 * The total row count this row declares for the whole conversation, or null when it declares
 * none. Every live row carried one (verified 2026-07-25 across 112 rows in four
 * conversations), but null is not treated as an anomaly: a markup change must degrade to the
 * pre-existing behavior rather than fail every export.
 *
 * A non-positive or unparseable value is null too — it could only weaken the checks it feeds,
 * and a fabricated total is worse than no total (AGENTS.md #5).
 */
function declaredRowTotal(row: Element): number | null {
  const raw = row.querySelector(selectors.messageArticle)?.getAttribute(selectors.setSizeAttr);
  if (raw === null || raw === undefined) return null;
  const total = Number.parseInt(raw, 10);
  return Number.isInteger(total) && total > 0 ? total : null;
}

/**
 * Turn the accumulated index→turn map into an ordered message list, failing loud on any
 * evidence of incompleteness rather than returning a partial conversation (AGENTS.md #4):
 * a gap in the index range, a range that does not start at position 0, a turn that never
 * yielded content, or a turn with no usable index.
 *
 * `seenRowIndices` makes the gap message honest. A missing position whose row was never
 * rendered means the walk did not reach it — retrying can help. A missing position whose row
 * DID render means it holds something this adapter does not recognize (an artifact card, a
 * tool call, a divider), and retrying never helps; that is a selector gap to report, not a
 * scroll problem. Both still fail loud — we cannot export what we cannot read — but telling
 * the user to "scroll through the whole conversation" when that is not the problem sends
 * them in circles.
 *
 * `declaredTotal` closes the one hole the index checks cannot see. Contiguity and the
 * starts-at-0 rule together prove the collected range is exactly `0…n-1`, but nothing
 * establishes that `n-1` is the LAST row: a walk that stopped short of the bottom yields a
 * range that passes both tests and exports as a plausible partial — the silent truncation
 * AGENTS.md #4 exists to prevent. Claude declares the conversation's row count on every row,
 * so a shortfall against it is proof. Null when no row declared one, in which case this check
 * is skipped and the pre-existing behavior stands.
 */
function buildMessages(
  turns: Map<number, CollectedTurn>,
  seenRowIndices: Set<number>,
  sawUnindexedTurn: boolean,
  declaredTotal: number | null,
): Message[] {
  const indices = [...turns.keys()].sort((a, b) => a - b);

  // Claude numbers virtualizer rows from zero (verified live 2026-07-25: `minIndex` 0 in four
  // separate walked conversations of 14, 16, 26 and 56 rows), so a
  // collected range that starts above zero is a hole exactly like
  // an interior one — it means the first turns were never collected, which contiguity alone
  // cannot see. Seeding the scan at -1 puts that leading range through the same check
  // instead of duplicating it. The reached-top guard in `collectVirtualizedTurns` covers only
  // the case where scrolling itself timed out; a walk that reaches the top and still misses
  // position 0 (a row holding something unreadable, say) gets past it.
  for (let k = 0; k < indices.length; k++) {
    const previous = k === 0 ? -1 : indices[k - 1];
    if (indices[k] === previous + 1) continue;
    const missing: number[] = [];
    for (let i = previous + 1; i < indices[k]; i++) missing.push(i);
    if (missing.every((i) => seenRowIndices.has(i))) throw unreadableRowsError(missing);
    // A leading hole is NOT a "scroll further" problem, even though its rows never rendered:
    // this runs only after the walk proved it reached `scrollTop <= 0`, so the user repeating
    // that scroll by hand does exactly what just failed. Ask for a report instead of sending
    // them in circles — the same reasoning that split the interior gap into two messages.
    throw new ExtractionError(
      k === 0
        ? `The conversation’s first ${missing.length === 1 ? 'turn' : `${missing.length} turns`} never ` +
          'loaded, even after scrolling to the top. Claude’s markup may have changed — please report this.'
        : `The conversation is missing turns between positions ${previous} and ${indices[k]}. ` +
          'Scroll through the whole conversation and try again.',
    );
  }

  // Trailing end. The scan above proved the collected positions are exactly `0…length-1`, so
  // anything Claude declares beyond that is a turn the walk never got. Split the same two
  // ways as an interior gap: rows that rendered hold markup this adapter cannot read, rows
  // that never rendered were never reached.
  if (declaredTotal !== null && indices.length < declaredTotal) {
    const missing: number[] = [];
    for (let i = indices.length; i < declaredTotal; i++) missing.push(i);
    if (missing.every((i) => seenRowIndices.has(i))) throw unreadableRowsError(missing);
    throw new ExtractionError(
      `The conversation’s last ${missing.length === 1 ? 'turn' : `${missing.length} turns`} never ` +
        `loaded — Claude reports ${declaredTotal} messages but only ${indices.length} could be read. ` +
        'Scroll to the end of the conversation and try again.',
    );
  }

  const messages: Message[] = [];
  let dropped = 0;
  for (const index of indices) {
    const turn = turns.get(index)!;
    if (turn.content.trim()) {
      messages.push({ role: turn.role, content: turn.content });
    } else {
      dropped++;
    }
  }

  if (messages.length > 0 && dropped > 0) {
    throw new ExtractionError(
      'Some conversation turns could not be read (empty or malformed). The conversation may ' +
        'still be loading — wait for it to finish, then try again.',
    );
  }
  if (messages.length > 0 && sawUnindexedTurn) {
    throw new ExtractionError(
      'A conversation turn is missing its position marker and could not be exported ' +
        'reliably. Claude’s markup may have changed — please report this.',
    );
  }
  return messages;
}

/**
 * The error for positions whose rows rendered but yielded no readable turn. Shared by the
 * interior-gap and trailing-end checks so the two cannot drift apart: both describe the same
 * condition — the walk saw the row, the adapter did not understand it — and both need the
 * user to report it rather than scroll again.
 */
function unreadableRowsError(missing: number[]): ExtractionError {
  return new ExtractionError(
    `The conversation contains ${missing.length === 1 ? 'a message' : 'messages'} at ` +
      `position ${missing.join(', ')} that this extension could not read — Claude’s markup ` +
      'may have changed, or the message may be a type it does not support yet. Please report this.',
  );
}

/**
 * The role of a matched turn node. Claude labels only the user side, so a turn that is not
 * a user bubble is the assistant's prose container — the two sets are disjoint (verified
 * live 2026-07-25: zero `.standard-markdown` nested inside a user turn).
 */
function roleOf(el: Element): Role {
  return el.matches(selectors.userMessage) ? 'user' : 'assistant';
}

/** Read a turn node's content, dispatching on role. */
function readTurn(el: Element): string {
  if (roleOf(el) === 'assistant') return htmlToMarkdown(el);
  return readUserContent(el);
}

/**
 * User turns are literal text, not rendered Markdown: Claude puts each paragraph in a
 * `p.whitespace-pre-wrap`, so the newlines the user typed are significant and must NOT go
 * through the serializer's inline path (which collapses whitespace runs). Read each block
 * child as text and join with blank lines, so multiple paragraphs stay separated instead of
 * being glued together by a single `textContent` read. Lists are the exception — their
 * markers exist only as markup, so they are serialized.
 */
function readUserContent(el: Element): string {
  const blocks: string[] = [];
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    // `blockToMarkdown`, not `htmlToMarkdown`: the list IS the block here, and treating it
    // as a container would serialize its `<li>`s as separate blocks and drop the markers.
    const text = tag === 'ul' || tag === 'ol' ? blockToMarkdown(child) : (child.textContent ?? '');
    if (text.trim()) blocks.push(text.trim());
  }
  if (blocks.length > 0) return blocks.join('\n\n');
  // No block children (or all empty): fall back to the container's own text so a markup
  // change degrades to readable content rather than an empty turn.
  const text = (el.textContent ?? '').trim();
  if (text) return text;
  // A turn holding only a pasted image has no readable text node. Describe it rather than
  // yielding empty — an empty turn fails the WHOLE export (AGENTS.md #4), so one
  // image-only message would block the conversation entirely. `img` is a standard tag, not
  // a guessed Claude selector.
  //
  // Measured 2026-07-29: this fallback never fires for an attachment. Across four mixed turns
  // and one attachment-only turn — files attached AND an image pasted, txt/pdf/png — the count
  // of `<img>` inside `user-message` was **0 every time**; every tile sits outside this node,
  // as a sibling subtree earlier in the row. So the mixed-turn layout is no longer unknown, and
  // the worry that a row-level scan would sweep up a pasted image inside the turn body is
  // disproved — which is what let the row scan in `record()` start covering claimed rows, so a
  // mixed turn now reports its file too. See docs/live-dom-verification.md → Claude → 2026-07-29.
  //
  // Kept anyway: it costs nothing, and it is the safe direction if Claude ever does render an
  // image inside the turn body — an empty turn would otherwise fail the WHOLE export.
  if (el.querySelector('img')) return '[Image]';
  return '';
}

/**
 * `[Artifact: title (kind)]` for each measured assistant artifact card in a row. The card is
 * outside `.standard-markdown`, so leaving it to `htmlToMarkdown` silently drops it. Only the
 * exact measured card/cell/title/kind structure is accepted; a matched card with missing or
 * duplicate metadata fails loud instead of inventing a label (AGENTS.md #4/#5).
 */
function artifactMarkers(row: Element): string {
  const cards = Array.from(row.querySelectorAll(selectors.artifactCard));
  const cells = Array.from(row.querySelectorAll(selectors.artifactCell));
  if (cards.length === 0) {
    // The cell is the only measured descendant marker that can survive a root-token rename.
    // Treating it as a card would invent the missing root relationship, so reject the row.
    if (cells.length > 0) {
      throw new ExtractionError(
        'Claude rendered an artifact card with an unrecognized root. Its metadata could not be read — please report this.',
      );
    }
    return '';
  }
  if (!row.querySelector(selectors.assistantMarkdown)) {
    throw new ExtractionError(
      'Claude rendered an artifact card without its corresponding assistant message. The markup may have changed — please report this.',
    );
  }

  const markers: string[] = [];
  for (const card of cards) {
    const cell = card.querySelector(selectors.artifactCell);
    const titles = cell ? Array.from(cell.querySelectorAll(selectors.artifactTitle)) : [];
    const kinds = cell ? Array.from(cell.querySelectorAll(selectors.artifactKind)) : [];
    const title = titles.length === 1 ? (titles[0].textContent ?? '').trim() : '';
    const kind = kinds.length === 1 ? (kinds[0].textContent ?? '').trim() : '';
    if (!cell || titles.length !== 1 || kinds.length !== 1 || !title || !kind) {
      throw new ExtractionError(
        'Claude rendered an artifact card whose title or kind could not be read. The markup may have changed — please report this.',
      );
    }
    markers.push(`[Artifact: ${title} (${kind})]`);
  }
  return markers.join('\n\n');
}

/**
 * The two shapes an attachment tile renders in, queried together so a row holding both
 * reports them in document order instead of grouped by shape. Reading only one of them is
 * what let a `.txt` block an entire export (see `selectors.attachmentCard`).
 */
const ATTACHMENT_TILES = `${selectors.attachmentImage}, ${selectors.attachmentCard}`;

/**
 * `[File: name]` for each attachment tile in a row, or an empty string when the row is not
 * an identifiable user attachment turn. The name comes from the preview tile's `alt` or the
 * file card's `h3` text, so a tile that renders without one is skipped rather than reported
 * under a fabricated name (AGENTS.md #5) — and a row whose tiles are ALL nameless yields no
 * markers, leaving it to fail loud rather than exporting a contentless turn.
 *
 * The `userActionBar` guard stays: `action-bar-edit` is user-exclusive (verified 2026-07-25 by
 * partitioning every test id in a 56-row conversation by role), and it is what attributes a
 * row with no `user-message` node to the user without guessing. It also keeps this safe to run
 * on assistant rows, which carry no such control.
 */
function attachmentMarkers(row: Element): string {
  if (!row.querySelector(selectors.userActionBar)) return '';
  return Array.from(row.querySelectorAll(ATTACHMENT_TILES))
    .map((tile) =>
      tile.matches(selectors.attachmentImage)
        ? tile.getAttribute('alt')?.trim()
        : (tile.textContent ?? '').trim(),
    )
    .filter((name): name is string => Boolean(name))
    .map((name) => `[File: ${name}]`)
    .join('\n\n');
}

/**
 * `nodes` minus the extended-thinking blocks — a turn node is dropped when it sits under a
 * `thinkingContainer` AND its row also holds a node that does not. Applied wherever turn nodes
 * are enumerated, so the walk and the one-shot snapshot cannot drift apart.
 *
 * The row condition is not defensive padding. Dropping every thinking block unconditionally
 * would leave a row whose only rendered node is one — a turn caught while it is still
 * generating, thinking shown and answer not yet — claimed by nothing, and an unclaimed row
 * fails the WHOLE export (`buildMessages`). Exporting the reasoning text is what happens today
 * and is the safe direction to degrade to; turning a working export into a hard failure is not.
 * A node with no row ancestor (the fixture path) is kept for the same reason: with no row there
 * is no evidence an answer was rendered beside it.
 */
function dropThinkingBlocks(nodes: Element[]): Element[] {
  const rowsWithAnswer = new Set<Element>();
  for (const el of nodes) {
    if (isThinkingBlock(el)) continue;
    const row = el.closest(selectors.turnRow);
    if (row) rowsWithAnswer.add(row);
  }
  return nodes.filter((el) => {
    if (!isThinkingBlock(el)) return true;
    const row = el.closest(selectors.turnRow);
    return row === null || !rowsWithAnswer.has(row);
  });
}

/**
 * Whether a turn node is an extended-thinking block rather than the answer. Shared by the
 * filter above and the walk's dedupe, which needs to know that a block only survived the
 * filter because no answer had rendered beside it yet.
 */
function isThinkingBlock(el: Element): boolean {
  return el.closest(selectors.thinkingContainer) !== null;
}

/**
 * The conversation title from `document.title`, which Claude formats as
 * `"<conversation title> - Claude"` (verified live 2026-07-25). A bare `Claude` means no
 * conversation title has been assigned yet.
 */
function deriveTitle(root: ParentNode): string {
  const raw = ownerDocument(root)?.title?.trim() ?? '';
  const title = raw.endsWith(TITLE_SUFFIX) ? raw.slice(0, -TITLE_SUFFIX.length).trim() : raw;
  return title && title !== 'Claude' ? title : 'Claude conversation';
}

function deriveUrl(root: ParentNode): string {
  return ownerDocument(root)?.defaultView?.location?.href ?? '';
}

const DOCUMENT_NODE = 9;

function ownerDocument(root: ParentNode): Document | null {
  // Detect a Document by nodeType rather than `instanceof Document` so this works under
  // any DOM implementation (live browser or a parsed test fixture).
  if ((root as Node).nodeType === DOCUMENT_NODE) return root as Document;
  return (root as Element).ownerDocument ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
