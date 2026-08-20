import type { Conversation, Message, Role } from '../../core/conversation';
import {
  advanceScrollPort,
  delay,
  findScrollableAncestor,
  isPortClamped,
  type SidebarConversation,
} from '../../core/sidebar';
import { ownerDocument } from '../../core/dom';
import { ExtractionError } from '../../core/errors';
import type { ConversationAdapter, OpenConversationOptions } from '../types';
import { htmlToMarkdown } from '../../core/html-to-markdown';
import { matches, matchesProject } from './matches';
import { selectors } from './selectors';

const PROVIDER = 'chatgpt';

// Auto-scroll tuning. ChatGPT virtualizes the message list and lazy-renders older
// turns as you scroll toward the top, so we scroll up repeatedly until the rendered
// message count stops growing (stable). Completion is judged purely by count
// stability — never by scrollTop, which the user or the browser can leave non-zero.
// The absolute cap is only an anti-runaway backstop: as long as new turns keep
// appearing we keep going, so a genuinely long conversation is not cut short.
const SCROLL_STEP_DELAY_MS = 150;
const SCROLL_STABLE_ROUNDS = 3;
const SCROLL_ABSOLUTE_MAX_STEPS = 400;
/**
 * Scroll tuning for the *conversation-list* loaders (`loadMoreConversations`,
 * `loadMoreProjectConversations`) — deliberately far more patient than the message-viewport
 * numbers above. Older turns are already in the client, but `#history` fetches each next
 * page from the server: measured round-trips of 1509–7516 ms across two independent cold runs
 * on a ~1047-row account (2026-07-28; the 1418–2830 ms first measured 2026-07-24 turned out to
 * understate the worst case by more than 2×). The viewport's 3 × 150 ms ≈ 450 ms stall
 * window elapses long before a batch lands, so the loader read "no new items" mid-fetch and
 * returned 19 of 852 conversations — a silent 2% truncation (AGENTS.md #4).
 *
 * ChatGPT exposes no verified "fetching" marker we may key on (AGENTS.md #5 forbids inventing
 * a spinner selector), so the terminal signal is partly time-based. The structural half is in
 * `scrollUntilStable`: the walk never settles while the container still scrolls, so every
 * landed page — which lets it scroll further again — resets the stall counter no matter how
 * long the fetch took. This window covers the remaining case, dwelling at the end while the
 * last page is still in flight.
 *
 * Sizing it needs the window the loader can actually *see*, and the rows of a pending page
 * render before their anchors do, so the conversation count stays flat across the render and
 * the fetch behind it alike — the measured worst case is the **7516 ms** inter-batch gap.
 * Twenty-three rounds of 500 ms gives 11.5 s from the scroll that triggers the fetch to giving
 * up, ~1.5× that gap. The previous ten rounds gave 5 s, which gaps exceeded in **both** cold
 * runs (5 of 74 batches), every one of them while the container was already clamped — the exact
 * state stalls are counted in, and the mechanism behind the 725-of-852 truncation measured
 * 2026-07-25. `SIDEBAR_SCROLL_DEFAULTS_TEST` pins the margin so it cannot be tuned back down
 * unnoticed. Time alone is still a guess about the tail, which is why `pageParityGate` supplies
 * structural evidence on top of it.
 *
 * The step cap is anti-runaway only, and must not be sized to the one account we measured.
 * Rounds scale with the conversation count N: stepping rounds ≈ N/17.5 (a ~700 px sidebar of
 * ~36 px rows, advanced 0.9 viewport per round) plus ~6 dwell rounds per 28-row page while its
 * fetch lands, plus the final dwell — `rounds(N) ≈ 0.271 N + 23` (up to +43 when parity holds
 * the walk open), which puts the measured ~1047-row account at ~307 rounds. A cap of
 * 600 would therefore throw on a *healthy* list at N ≈ 2100, discarding the entire
 * accumulation; 2000 carries N ≈ 7200 and bounds a genuinely runaway list at
 * 2000 × 500 ms ≈ 17 minutes. The long pathological wait is the deliberate side of that trade:
 * failing early on a real history is the worse outcome.
 */
const SIDEBAR_STEP_DELAY_MS = 500;
const SIDEBAR_STABLE_ROUNDS = 23;
/**
 * Extra stall rounds granted while `pageParityGate` reports a page is still owed — 20 more,
 * so a parity-backed wait runs to 21.5 s rather than 11.5. Bounded rather than open-ended because
 * parity is asymmetric evidence: a list whose length is an exact multiple of the page size
 * ends on a full-size page and looks identical to one page short, so an unbounded wait would
 * spin to the step cap and fail loud on a perfectly complete account (~1 in 28 of them).
 * When this budget runs out the walk returns what it has and reports it via `onIncomplete`.
 */
const SIDEBAR_PENDING_EXTRA_ROUNDS = 20;
const SIDEBAR_ABSOLUTE_MAX_STEPS = 2000;
const SIDEBAR_SCROLL_DEFAULTS: AutoScrollOptions = {
  stepDelayMs: SIDEBAR_STEP_DELAY_MS,
  stableRounds: SIDEBAR_STABLE_ROUNDS,
  maxSteps: SIDEBAR_ABSOLUTE_MAX_STEPS,
};
/**
 * The sidebar defaults, exported solely so a test can assert the stall window still exceeds
 * the measured lazy-load latency. Not part of the adapter's runtime contract — callers pass
 * overrides through `AutoScrollOptions` instead.
 */
export const SIDEBAR_SCROLL_DEFAULTS_TEST: Readonly<AutoScrollOptions> = SIDEBAR_SCROLL_DEFAULTS;
// Fraction of the viewport to advance per step during the conversation-list walk
// (`loadMoreConversations` / `loadMoreProjectConversations`). A step, not a jump to
// `scrollHeight`: the history sidebar is a recycling virtualizer whose spacer height is
// restated as rows render, so a jump skips straight past windows that were never mounted.
// The ~10% overlap guarantees consecutive windows abut with no gap.
const SIDEBAR_STEP_FRACTION = 0.9;
// Fraction of the viewport to advance per step during the content-collection pass
// (see `collectVirtualizedTurns`). At 0.5 each region of the list falls inside two
// consecutive windows, so every turn is seen at least twice — once to record it, again
// to upgrade its content if the first sighting caught an un-hydrated skeleton.
const WALK_STEP_FRACTION = 0.5;
// Hard anti-runaway ceiling for the collection walk, far above any real conversation's
// step count (the primary bound is derived from the live scroll height per iteration).
const WALK_ABSOLUTE_MAX_STEPS = 2000;

/** Overridable knobs so the loop can be unit-tested without real timers/DOM. */
export interface AutoScrollOptions {
  stepDelayMs?: number;
  stableRounds?: number;
  maxSteps?: number;
}

/**
 * `AutoScrollOptions` plus the conversation-list loaders' progress callback. Kept separate
 * from `AutoScrollOptions` itself, which `extract`'s message-viewport walk also uses and has
 * no use for a progress signal.
 */
export interface LoadMoreScrollOptions extends AutoScrollOptions {
  onProgress?: (loaded: number) => void;
  /**
   * Fired once if the walk gave up while the page-size parity oracle still said another page
   * was owed — i.e. the returned list may be short. Callers should surface this rather than
   * present the result as complete (AGENTS.md #4); omit it and the loop is unchanged.
   */
  onIncomplete?: () => void;
  /**
   * A page size an earlier walk over the same list measured (see `onPageSize`). Supplying it
   * lets `pageParityGate` judge parity on a **re-run over an already-loaded list**, where its
   * own first-read seed would be the whole list rather than one page. Omit on a first walk over
   * a fresh sidebar, where the seed is the measured truth.
   *
   * Pass only a size `onPageSize` reported, never a hand-picked one. Too large and no increment
   * can match it, so the gate goes quiet and the walk falls back to the plain dwell — it costs
   * the wait, never rows, which are collected either way. Too small is the direction that can
   * actually mislead: a short FINAL page whose length happens to equal it reads as full-size and
   * warns on a complete list. `onPageSize` cannot hand back an under-sized value, which is why
   * it, and not the caller, decides what is worth caching.
   */
  knownPageSize?: number;
  /**
   * Fired with the page size whenever a full page is *observed* arriving, so a caller can cache
   * it and hand it back as `knownPageSize` on the next call. Never fired for evidence the gate
   * only guessed at — a short final page, or a seed taken over an already-loaded list. May fire
   * more than once with the same value; the latest is the one to keep.
   */
  onPageSize?: (size: number) => void;
}

// ChatGPT's own icon-button classes — the same shape as the header's native square
// icon controls (e.g. the conversation-options button): a 36px square, centered
// glyph, rounded corners, and the surface-hover token. Wearing them makes the
// icon-only export buttons indistinguishable from ChatGPT's chrome in both themes.
// Owned by the adapter (not the content layer) to keep provider CSS knowledge here;
// if ChatGPT renames these tokens the buttons degrade to unstyled-but-functional.
const TOOLBAR_BUTTON_CLASS =
  'text-token-text-primary hover:bg-token-surface-hover flex h-9 w-9 items-center justify-center rounded-lg';

// ChatGPT's own labeled secondary-button classes — the shape of the project page's
// native controls (e.g. the Share button): a bordered, fully-rounded 36px pill with a
// centered icon+label, theme-aware via the `btn-secondary` token. Wearing them makes
// the project "Download all" trigger blend with ChatGPT's chrome in both themes.
// Verified against the live page (2026-07-18); if ChatGPT renames these tokens the
// trigger degrades to an unstyled-but-functional button.
const PROJECT_TOOLBAR_BUTTON_CLASS = 'btn btn-secondary h-9 px-3';

// Bulk navigation tuning. After a sidebar link is clicked, ChatGPT swaps the route
// instantly but renders the new conversation's turns a beat later (measured ~1s on a
// warm session); the old turns are unmounted first, so a readiness check that only
// waits for "any message present" could momentarily read the outgoing conversation.
// `openConversation` therefore waits for the message set to actually change. The
// timeout is generous so a cold/slow load still resolves rather than falsely failing.
const OPEN_POLL_MS = 150;
const OPEN_TIMEOUT_MS = 15000;

export const chatgptAdapter: ConversationAdapter = {
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
  loadMoreProjectConversations,
  projectToolbarMount,
  projectToolbarButtonClass: PROJECT_TOOLBAR_BUTTON_CLASS,
};

/**
 * The header pill holding ChatGPT's native Share / conversation-options controls —
 * the injection point for the export buttons. All ChatGPT DOM knowledge lives in
 * this adapter (docs/conventions.md), so the content layer asks for the mount point
 * instead of hardcoding a selector. Null when the header has not rendered yet or the
 * markup changed; the caller then falls back to a non-overlapping overlay.
 */
function toolbarMount(root: ParentNode = document): Element | null {
  return root.querySelector(selectors.headerActions);
}

/**
 * The native Share button — the export buttons are placed immediately to its left,
 * beside it rather than replacing it. Null when Share has not rendered; the content
 * layer then mounts at the front of the header bar. DOM knowledge stays in the
 * adapter (docs/conventions.md).
 */
function toolbarAnchor(root: ParentNode = document): Element | null {
  return root.querySelector(selectors.shareButton);
}

/**
 * Enumerate the history sidebar's conversation links into the lightweight sidebar
 * model, in display order. Scoped to `#history` so project/GPT chats (under
 * `/g/…/c/…`) and the composer are excluded. Deduped by path id because the active
 * chat's link can carry a `?messageId=…` query (a second link to the same id); the
 * full title comes from the link's `aria-label` (untruncated), falling back to its
 * text. Pure DOM read — returns `[]` when the sidebar has not rendered.
 */
function listConversations(root: ParentNode = document): SidebarConversation[] {
  const history = root.querySelector(selectors.sidebarHistory);
  if (!history) return [];

  const acc = new Map<string, SidebarConversation>();
  collectConversations(
    history.querySelectorAll(selectors.sidebarConversationLink),
    documentOrigin(root),
    historyTitle,
    acc,
  );
  return [...acc.values()];
}

/** The untruncated human title of a history-sidebar conversation link. */
function historyTitle(anchor: Element): string {
  return (anchor.getAttribute('aria-label') ?? anchor.textContent ?? '').trim();
}

/** The human title of a project-list conversation link (the `.font-medium` block). */
function projectTitle(anchor: Element): string {
  const titleEl = anchor.querySelector?.(selectors.projectConversationTitle);
  return (titleEl?.textContent ?? anchor.textContent ?? '').trim();
}

/** Split a conversation href into its stable `/c/<id>` id and a query-free absolute URL. */
function resolveConversationHref(href: string, origin: string): { id: string; url: string } {
  try {
    const parsed = new URL(href, origin);
    return { id: conversationIdFromPath(parsed.pathname), url: origin + parsed.pathname };
  } catch {
    return { id: '', url: '' };
  }
}

/**
 * The stable conversation id from any conversation pathname — plain `/c/<id>` or a
 * project-scoped `/g/g-p-<id>[-slug]/c/<id>`. The `/c/` segment is the identity; the
 * project prefix and slug vary by context, so keying on this dedupes the same chat
 * seen as a project-list link and as a sidebar-expando link. `''` when absent.
 */
function conversationIdFromPath(pathname: string): string {
  const match = pathname.match(/\/c\/([^/?#]+)/);
  return match ? match[1] : '';
}

function documentOrigin(root: ParentNode): string {
  const origin = ownerDocument(root)?.defaultView?.location?.origin;
  // Fixture documents load at about:blank (`origin === 'null'`); fall back to the
  // real host so enumerated URLs are still absolute and openable.
  return origin && origin !== 'null' ? origin : 'https://chatgpt.com';
}

/**
 * Client-side navigate to a sidebar conversation and resolve once its turns render.
 * Clicks the in-sidebar link so ChatGPT's router swaps content in place (assigning
 * `location` would full-reload and kill the bulk run). Fail-loud (AGENTS.md #4): if
 * the link is not in the (possibly virtualized) sidebar, or the conversation does not
 * render within the timeout, throw so the bulk driver records the miss instead of
 * re-extracting the previous chat. Already-open target → resolve immediately.
 */
async function openConversation(url: string, opts: OpenConversationOptions = {}): Promise<void> {
  const { pollMs = OPEN_POLL_MS, timeoutMs = OPEN_TIMEOUT_MS } = opts;
  const targetPath = new URL(url, location.origin).pathname;

  // Already showing the target with content: it's the right conversation, no nav.
  if (location.pathname === targetPath && hasRenderedMessages()) return;

  const anchor = findSidebarAnchor(targetPath);
  if (!anchor) {
    throw new ExtractionError(
      'Could not open a selected conversation: its link was not found in the sidebar ' +
        '(the history list may need scrolling into view). It was skipped.',
    );
  }

  // Snapshot the current turns so we can tell the new conversation has actually
  // swapped in — the outgoing turns are briefly still mounted right after the click.
  const beforeSignature = messageSignature();
  anchor.click();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(pollMs);
    if (location.pathname === targetPath && hasRenderedMessages() && messageSignature() !== beforeSignature) {
      return;
    }
  }
  throw new ExtractionError(
    'Timed out opening a selected conversation. It may be loading slowly; it was skipped.',
  );
}

/** The `#history` link whose path matches `targetPath`, or null if not currently rendered. */
function findSidebarAnchor(targetPath: string): HTMLAnchorElement | null {
  const history = document.querySelector(selectors.sidebarHistory);
  if (!history) return null;
  for (const anchor of history.querySelectorAll<HTMLAnchorElement>(selectors.sidebarConversationLink)) {
    const href = anchor.getAttribute('href');
    if (href && new URL(href, location.origin).pathname === targetPath) return anchor;
  }
  return null;
}

/**
 * The Project home page's conversation-list `<section>` — the container wrapping the
 * `<ol>` of conversation rows. Found as the nearest `<section>` ancestor of a project
 * conversation link, which deliberately skips the persistent left-nav sidebar expando:
 * once a project conversation has been opened, that expando also lists the project's
 * conversations, but its links have no `<section>` ancestor, so they are excluded here
 * (verified live 2026-07-18 — without this, the trigger's mount and the bulk list would
 * wrongly bind to the sidebar). Null when the list has not rendered yet or the markup
 * changed; the content layer then falls back to a non-overlapping overlay. Doubles as
 * the trigger's mount point. DOM knowledge stays in the adapter (docs/conventions.md).
 */
function projectListSection(root: ParentNode): Element | null {
  for (const link of root.querySelectorAll(selectors.projectConversationLink)) {
    const section = link.closest('section');
    if (section) return section;
  }
  return null;
}

/** Where the project bulk-download trigger mounts: the conversation-list section. */
function projectToolbarMount(root: ParentNode = document): Element | null {
  return projectListSection(root);
}

/**
 * Enumerate the conversations on a Project home page into the lightweight sidebar
 * model, in display order. Scoped to the list `<section>` (so the left-nav expando is
 * excluded — see `projectListSection`), reading the project list links
 * (`/g/g-p-<id>[-slug]/c/<id>`) deduped by the stable `/c/<id>` id; the title comes
 * from the link's `.font-medium` block (the human title, distinct from the
 * message-preview snippet beside it), falling back to the link text. Pure DOM read —
 * returns `[]` when the list has not rendered. Mirrors `listConversations`.
 */
function listProjectConversations(root: ParentNode = document): SidebarConversation[] {
  const section = projectListSection(root);
  if (!section) return [];

  const acc = new Map<string, SidebarConversation>();
  collectConversations(
    section.querySelectorAll(selectors.projectConversationLink),
    documentOrigin(root),
    projectTitle,
    acc,
  );
  return [...acc.values()];
}

/**
 * Client-side navigate to a project conversation and resolve once its turns render.
 * Unlike `openConversation` (which clicks a `#history` link), the target anchor may be
 * in the project home page's list OR in the persistent project sidebar expando shown
 * once a conversation is open — so it is located by conversation id across whichever is
 * currently in the DOM. Fail-loud (AGENTS.md #4): throws when the link is not present
 * or the conversation does not render in time. Already-open target → resolve at once.
 */
async function openProjectConversation(url: string, opts: OpenConversationOptions = {}): Promise<void> {
  const { pollMs = OPEN_POLL_MS, timeoutMs = OPEN_TIMEOUT_MS } = opts;
  const targetId = conversationIdFromPath(new URL(url, location.origin).pathname);

  // Already showing the target conversation with content: no navigation needed.
  if (conversationIdFromPath(location.pathname) === targetId && hasRenderedMessages()) return;

  const anchor = findProjectConversationAnchor(targetId);
  if (!anchor) {
    throw new ExtractionError(
      'Could not open a selected project conversation: its link was not found on the page ' +
        '(the project list may need scrolling into view). It was skipped.',
    );
  }

  const beforeSignature = messageSignature();
  anchor.click();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(pollMs);
    if (
      conversationIdFromPath(location.pathname) === targetId &&
      hasRenderedMessages() &&
      messageSignature() !== beforeSignature
    ) {
      return;
    }
  }
  throw new ExtractionError(
    'Timed out opening a selected project conversation. It may be loading slowly; it was skipped.',
  );
}

/** The currently-rendered project conversation link for `convId`, or null. */
function findProjectConversationAnchor(convId: string): HTMLAnchorElement | null {
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(selectors.projectConversationLink)) {
    const href = anchor.getAttribute('href');
    if (href && conversationIdFromPath(new URL(href, location.origin).pathname) === convId) return anchor;
  }
  return null;
}

/**
 * Client-side navigate from a project conversation back to the project home page
 * `homeUrl` (where a bulk run started), resolving once the project list has re-rendered.
 * The back-to-project link is matched to `homeUrl`'s project id, not taken as the first
 * `…/project` anchor, so a page listing several projects' home links returns the user to
 * the project they exported from — not a different one. Best-effort: resolves immediately
 * if already on that project's home page; throws `ExtractionError` (fail-loud) only if no
 * matching link is present or the home page never renders — the bulk caller swallows that
 * (the batch result is unaffected).
 */
async function openProjectHome(homeUrl: string, opts: OpenConversationOptions = {}): Promise<void> {
  const { pollMs = OPEN_POLL_MS, timeoutMs = OPEN_TIMEOUT_MS } = opts;

  const targetId = projectIdFromPath(new URL(homeUrl, location.origin).pathname);
  const onTargetHome = (): boolean =>
    matchesProject(location.href) &&
    projectIdFromPath(location.pathname) === targetId &&
    hasRenderedProjectList();

  if (onTargetHome()) return;

  const back = findProjectBackLink(targetId);
  if (!back) {
    throw new ExtractionError('Could not return to the project home: its back link was not found.');
  }
  back.click();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(pollMs);
    if (onTargetHome()) return;
  }
  throw new ExtractionError('Timed out returning to the project home page.');
}

/**
 * The stable project id (`g-p-<id>`) from a project or project-conversation pathname,
 * ignoring any trailing `-<slug>` (which varies by context) and the conversation part.
 * `''` when absent. Lets the return-to-home step match links across slug variants.
 */
function projectIdFromPath(pathname: string): string {
  const match = pathname.match(/\/g\/(g-p-[0-9a-fA-F]+)/);
  return match ? match[1] : '';
}

/** The back-to-project link for `projectId`, or null. Falls back to null (never a wrong project). */
function findProjectBackLink(projectId: string): HTMLAnchorElement | null {
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(selectors.projectBackLink)) {
    const href = anchor.getAttribute('href');
    if (href && projectIdFromPath(new URL(href, location.origin).pathname) === projectId) return anchor;
  }
  return null;
}

function hasRenderedProjectList(): boolean {
  return document.querySelector(selectors.projectConversationLink) !== null;
}

function hasRenderedMessages(): boolean {
  return document.querySelector(selectors.message) !== null;
}

/**
 * A cheap fingerprint of the rendered turn set (count + first turn id). Changes when
 * ChatGPT swaps conversations, so `openConversation` can distinguish the newly loaded
 * chat from the outgoing one without diffing the whole DOM. Turn ids are globally
 * unique, so a different first id means a different conversation.
 */
function messageSignature(): string {
  const nodes = document.querySelectorAll(selectors.message);
  const firstId = nodes[0]?.getAttribute(selectors.messageIdAttr) ?? '';
  return `${nodes.length}:${firstId}`;
}

export async function extract(root: ParentNode = document, options: AutoScrollOptions = {}): Promise<Conversation> {
  // On the live page ChatGPT virtualizes the message list by *windowing*: only a
  // handful of turn nodes exist in the DOM at once (the rest are removed, not merely
  // emptied), so a single `querySelectorAll` can never see the whole conversation.
  // Collect turns by scrolling through the list and accumulating each one as it enters
  // the window. Fixture roots are fully materialized, so they use the one-shot read.
  const messages =
    root === (globalThis as { document?: Document }).document
      ? await collectVirtualizedTurns(root as Document, options)
      : readSnapshot(root);

  if (messages.length === 0) {
    throw new ExtractionError(
      'No messages found on the page. The conversation may not have loaded, or ChatGPT’s ' +
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
 * One-shot read of every turn currently in `root` (fixtures, or a live page with no
 * scroll container). Fails loud if a role-bearing turn yielded no content — a silently
 * dropped turn would be worse than a visible error (AGENTS.md #4).
 */
function readSnapshot(root: ParentNode): Message[] {
  const roleNodes = Array.from(root.querySelectorAll(selectors.message)).filter(hasKnownRole);
  const messages = roleNodes.map(toMessage).filter((m): m is Message => m !== null);
  if (messages.length > 0 && messages.length < roleNodes.length) {
    throw new ExtractionError(
      'Some conversation turns could not be read (empty or malformed). The conversation may ' +
        'still be loading — wait for it to finish, then try again.',
    );
  }
  return messages;
}

function hasKnownRole(el: Element): boolean {
  const role = el.getAttribute(selectors.authorRoleAttr);
  return role === 'user' || role === 'assistant' || role === 'system';
}

/**
 * A turn's extracted content plus whether it came from a *reliable* source (a known
 * content container or a file/image marker) rather than the bare `el.textContent`
 * fallback. The walk uses `reliable` to replace a skeleton that was first captured via
 * the fallback (which can pick up stray UI text like "Copy"/"Edit") once the real
 * content element renders.
 */
interface TurnRead {
  content: string;
  reliable: boolean;
}

/** Read a turn node's content + reliability, dispatching on role. */
function readTurn(el: Element): TurnRead {
  const role = el.getAttribute(selectors.authorRoleAttr) as Role;
  if (role === 'assistant') {
    const markdownEl = el.querySelector(selectors.assistantMarkdown);
    // Fall back to plain text if the prose container is missing so a markup change
    // degrades to readable text rather than an empty message (but mark it unreliable).
    if (markdownEl) return { content: htmlToMarkdown(markdownEl), reliable: true };
    return { content: (el.textContent ?? '').trim(), reliable: false };
  }
  // User turns are plain (already markdown-ish) text in a pre-wrap block.
  const textEl = el.querySelector(selectors.userText);
  const base = (textEl?.textContent ?? '').trim();
  const files = fileMarkers(el);
  const combined = [base, files].filter(Boolean).join('\n\n');
  if (combined) return { content: combined, reliable: true };
  // A turn with only an uploaded file or a lone image has no readable text node; describe
  // it rather than dropping it (which would fail the whole export — AGENTS.md #4).
  if (el.querySelector('img')) return { content: '[Image]', reliable: true };
  return { content: (el.textContent ?? '').trim(), reliable: false };
}

/** Map one message DOM node to a normalized Message, or null if it has no content. */
function toMessage(el: Element): Message | null {
  const { content } = readTurn(el);
  if (!content.trim()) return null;
  const role = el.getAttribute(selectors.authorRoleAttr) as Role;
  const id = el.getAttribute(selectors.messageIdAttr);
  const message: Message = { role, content };
  if (id) message.id = id;
  return message;
}

/** `[File: name]` for each attachment tile in a turn (empty string when there are none). */
function fileMarkers(el: Element): string {
  return Array.from(el.querySelectorAll(selectors.attachmentTile))
    .map((tile) => tile.getAttribute('aria-label')?.trim())
    .filter((name): name is string => Boolean(name))
    .map((name) => `[File: ${name}]`)
    .join('\n\n');
}

function deriveTitle(root: ParentNode): string {
  const doc = ownerDocument(root);
  const title = doc?.title?.trim();
  return title && title !== 'ChatGPT' ? title : 'ChatGPT conversation';
}

function deriveUrl(root: ParentNode): string {
  return ownerDocument(root)?.defaultView?.location?.href ?? '';
}

/**
 * Scroll the message viewport to the top repeatedly to force ChatGPT to render
 * lazily-loaded older turns, stopping once the rendered-message count holds steady
 * for a few rounds (i.e. no more older turns appear). Progress resets the stall
 * counter, so an arbitrarily long conversation keeps loading as long as new turns
 * keep arriving. Only the absolute step cap — reached solely if turns never stop
 * appearing — is a fail-loud condition (AGENTS.md #4); completion is judged by
 * count stability alone, never by `scrollTop` (which the user or browser may leave
 * non-zero), so a fully-loaded conversation never falsely fails.
 */
export async function autoScrollToLoad(doc: Document, options: AutoScrollOptions = {}): Promise<void> {
  const container = doc.querySelector<HTMLElement>(selectors.scrollContainer);
  if (!container) return; // Best-effort: extract whatever is already present.

  // Messages lazy-load as you scroll UP (older turns above), so pin to the top.
  await scrollUntilStable(container, () => doc.querySelectorAll(selectors.message).length, pinTop, options, {
    timeoutMessage:
      'Timed out loading the full conversation while scrolling. The conversation may be ' +
      'unusually long; try again, or report if this persists.',
  });
}

interface CollectedTurn {
  role: Role;
  content: string;
  reliable: boolean;
}

/**
 * Read the whole conversation off a live, virtualized message list. ChatGPT *windows*
 * the list — only a handful of turn nodes exist in the DOM at once, and off-screen turns
 * are removed entirely — so no single `querySelectorAll` sees every turn. This scrolls
 * from top to bottom in overlapping steps and accumulates each turn (keyed by its stable
 * `data-message-id`) the first time it enters the window, upgrading its content on a later
 * sighting if the first was still an un-hydrated skeleton. Turn order is the first-seen
 * order during the strictly-downward walk, which equals conversation order. Falls back to
 * a one-shot snapshot read when there is no scroll container (best-effort). Fails loud if
 * a turn is seen but never yields content, so a windowed conversation is never silently
 * truncated (AGENTS.md #4).
 */
export async function collectVirtualizedTurns(doc: Document, options: AutoScrollOptions = {}): Promise<Message[]> {
  const container = doc.querySelector<HTMLElement>(selectors.scrollContainer);
  // A zero-height container (hidden/background tab) never actually scrolls, so the walk
  // below would crawl 1px at a time up to the absolute cap — minutes of a frozen tab.
  // Fall back to a one-shot read instead.
  if (!container || container.clientHeight === 0) return readSnapshot(doc);

  // Pull in any older turns first (long chats paginate them in as you reach the top),
  // then walk down from the very top. `autoScrollToLoad` leaves the viewport pinned there.
  await autoScrollToLoad(doc, options);

  const { stepDelayMs = SCROLL_STEP_DELAY_MS } = options;
  const stepPx = Math.max(1, Math.floor(container.clientHeight * WALK_STEP_FRACTION));

  const order: string[] = [];
  const turns = new Map<string, CollectedTurn>();
  let sawIdlessTurn = false;
  const record = (): void => {
    for (const el of Array.from(doc.querySelectorAll(selectors.message))) {
      if (!hasKnownRole(el)) continue;
      const id = el.getAttribute(selectors.messageIdAttr);
      if (!id) {
        // No stable key to dedup this turn across windows, so it can never be collected.
        // Flag it so we fail loud rather than silently omit it (AGENTS.md #4).
        sawIdlessTurn = true;
        continue;
      }
      const { content, reliable } = readTurn(el);
      const seen = turns.get(id);
      if (!seen) {
        order.push(id);
        turns.set(id, { role: el.getAttribute(selectors.authorRoleAttr) as Role, content, reliable });
      } else if ((!seen.content.trim() && content.trim()) || (!seen.reliable && reliable)) {
        // Upgrade a turn first captured empty, or captured via the unreliable textContent
        // fallback (which can grab stray UI text), once its real content element renders.
        seen.content = content;
        seen.reliable = reliable;
      }
    }
  };

  container.scrollTop = 0;
  await delay(stepDelayMs);
  let atBottomHits = 0;
  let reachedBottom = false;
  for (let step = 0; ; step++) {
    record();
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 1) {
      if (++atBottomHits >= 2) {
        reachedBottom = true;
        break; // settle on the bottom (its content may still hydrate)
      }
    } else {
      atBottomHits = 0;
    }
    // Cap recomputed from the current height so a list that grows as it hydrates is not
    // cut short, while a stuck loop still terminates. Overridable for tests. A fixed
    // absolute ceiling backstops against a pathologically growing height (defense-in-depth,
    // far above any real conversation's step count).
    const cap = options.maxSteps ?? Math.ceil(container.scrollHeight / stepPx) + SCROLL_STABLE_ROUNDS + 5;
    if (step >= cap || step >= WALK_ABSOLUTE_MAX_STEPS) break;
    container.scrollTop = Math.min(container.scrollTop + stepPx, container.scrollHeight);
    await delay(stepDelayMs);
  }

  // The walk hit a step cap before reaching the bottom: turns below the last window were
  // never seen and are absent from `turns`, so the `dropped` check below cannot detect the
  // missing tail. Fail loud rather than return a silently truncated conversation (AGENTS.md #4).
  if (!reachedBottom) {
    throw new ExtractionError(
      'Timed out loading the full conversation while scrolling. The conversation may be ' +
        'unusually long; try again, or report if this persists.',
    );
  }

  const messages: Message[] = [];
  let dropped = 0;
  for (const id of order) {
    const turn = turns.get(id)!;
    if (turn.content.trim()) {
      messages.push({ role: turn.role, content: turn.content, id });
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
  // A turn with no message id can't be collected across windows; retrying won't help, so give
  // it its own message rather than the "still loading" one (AGENTS.md #4 — never silently omit).
  if (messages.length > 0 && sawIdlessTurn) {
    throw new ExtractionError(
      'A conversation turn is missing its identifier and could not be exported reliably. ' +
        'ChatGPT’s markup may have changed — please report this.',
    );
  }
  return messages;
}

/**
 * Load every not-yet-rendered conversation in the virtualized history sidebar by
 * scrolling it to the bottom until no *new* conversation appears, so the bulk panel's
 * re-scan sees the full list. Best-effort: resolves immediately when the sidebar (or
 * its scroll container) is absent. Fail-loud (AGENTS.md #4) only on the runaway cap —
 * new conversations never stop appearing — mirroring `autoScrollToLoad`.
 *
 * Scrolls one viewport per round (one `advanceScrollPort` step, not a jump to the bottom) so every window
 * of a recycling virtualizer is rendered in turn. Progress is judged by the count of
 * *distinct conversation ids* seen across rounds, not the raw rendered-node count: a
 * windowed virtualizer recycles a fixed-size node pool (holding the node count flat while
 * the ids inside it change), so counting cumulative unique ids keeps loading as long as
 * genuinely new conversations surface. Because `#history` pages in from the server, the
 * loader also refuses to settle while the container still scrolls, and dwells at the end far
 * longer than the message viewport does — see `SIDEBAR_SCROLL_DEFAULTS`, `endOfListGate`, and
 * `scrollUntilStable`. Each round's rows are folded into `acc` as they
 * pass through the viewport, so conversations the virtualizer trims off the top (or has
 * not yet scrolled into view) are all captured; the returned list is the full accumulation
 * across every scroll round, not just the final on-screen window.
 */
export async function loadMoreConversations(
  root: ParentNode = document,
  options: LoadMoreScrollOptions = {},
): Promise<SidebarConversation[]> {
  const history = root.querySelector(selectors.sidebarHistory);
  if (!history) return [];
  const container = findScrollableAncestor(history);

  const origin = documentOrigin(root);
  const acc = new Map<string, SidebarConversation>();
  await scrollUntilStable(
    container,
    () => collectConversations(history.querySelectorAll(selectors.sidebarConversationLink), origin, historyTitle, acc),
    () => advanceScrollPort(container, SIDEBAR_STEP_FRACTION),
    options,
    {
      timeoutMessage:
        'Timed out loading the conversation list while scrolling. The sidebar may be ' +
        'unusually long; try again, or report if this persists.',
      settled: endOfListGate(),
      // Counted over EVERY conversation row, not the `/c/` ids accumulated above — only the
      // raw row count pages in at a fixed size (see `pageParityGate`).
      pending: pageParityGate(() => history.querySelectorAll(selectors.sidebarConversationRow).length, {
        knownPageSize: options.knownPageSize,
        onPageSize: options.onPageSize,
      }),
      pendingExtraRounds: SIDEBAR_PENDING_EXTRA_ROUNDS,
      defaults: SIDEBAR_SCROLL_DEFAULTS,
      onProgress: options.onProgress,
      onIncomplete: options.onIncomplete,
    },
  );
  return [...acc.values()];
}

/**
 * Like `loadMoreConversations`, but for a Project home page's virtualized conversation
 * list. Scrolls the list `<section>`'s scroll container to the bottom until no new
 * conversation id appears, accumulating every surfaced row across rounds and returning
 * the full list. Best-effort when the list/container is absent; fail-loud on runaway.
 */
export async function loadMoreProjectConversations(
  root: ParentNode = document,
  options: LoadMoreScrollOptions = {},
): Promise<SidebarConversation[]> {
  const section = projectListSection(root);
  if (!section) return [];
  const container = findScrollableAncestor(section);

  const origin = documentOrigin(root);
  const acc = new Map<string, SidebarConversation>();
  await scrollUntilStable(
    container,
    () => collectConversations(section.querySelectorAll(selectors.projectConversationLink), origin, projectTitle, acc),
    () => advanceScrollPort(container, SIDEBAR_STEP_FRACTION),
    options,
    {
      timeoutMessage:
        'Timed out loading the project conversation list while scrolling. The list may be ' +
        'unusually long; try again, or report if this persists.',
      settled: endOfListGate(),
      defaults: SIDEBAR_SCROLL_DEFAULTS,
      onProgress: options.onProgress,
    },
  );
  return [...acc.values()];
}

/**
 * Fold the currently-rendered `links` into `acc` — an ordered `id → SidebarConversation`
 * map — and return its running size. Keyed by the stable `/c/<id>` id (via
 * `resolveConversationHref`) so the same chat rendered twice, or a node recycled back into
 * view, is stored once in first-seen (top→bottom) order; `titleOf` supplies the per-track
 * title extraction. Because `acc` persists across scroll rounds, rows the virtualizer later
 * trims off the top stay captured — the cumulative size is the progress signal
 * `scrollUntilStable` needs, and `acc` itself is the full list the loader returns.
 */
function collectConversations(
  links: Iterable<Element>,
  origin: string,
  titleOf: (anchor: Element) => string,
  acc: Map<string, SidebarConversation>,
): number {
  for (const anchor of links) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    const { id, url } = resolveConversationHref(href, origin);
    if (!id || acc.has(id)) continue;
    acc.set(id, { id, title: titleOf(anchor) || 'ChatGPT conversation', url });
  }
  return acc.size;
}

/** Pin a virtualized scroll container to the top (loads older items above). */
function pinTop(container: HTMLElement): void {
  container.scrollTop = 0;
}

/**
 * A stateful end-of-list test for a downward walk: true once the scroll step has stopped
 * moving the container, i.e. the browser is clamping `scrollTop` because there is nothing
 * left to scroll into. Each call compares against the position the previous round's step
 * left behind, so it must be created fresh per walk.
 *
 * Deliberately a position *delta* rather than the `scrollTop + clientHeight >= scrollHeight`
 * arithmetic used for the message viewport: `findScrollableAncestor` resolves whichever
 * ancestor actually scrolls, which can be a port taller than the list itself (the project
 * page's stage scroll port measured `scrollH 730 > clientH 400` while merely *containing*
 * the list section — see `docs/live-dom-verification.md`). Such a container's arithmetic
 * bottom may sit below anything the list walk can reach, and requiring it would spin to the
 * step cap and fail loud on a perfectly healthy list. The delta test converges on any
 * container that clamps, whatever its height is made of. A zero-height container
 * (hidden/background tab) never scrolls at all, so it counts as ended immediately rather
 * than creeping 1px per round to the cap.
 */
function endOfListGate(): (container: HTMLElement) => boolean {
  let previousTop = -1;
  return (container) => {
    const clamped = isPortClamped(container, previousTop);
    previousTop = container.scrollTop;
    return clamped;
  };
}

/**
 * A stateful "is another page still owed?" test, built on the one regularity live measurement
 * found in `#history`: the server appends a **fixed number of rows per page** — 28 across 36
 * consecutive pages on a 1042-conversation account (2026-07-29) — with only the final page
 * short. So a full-size last increment means the list was cut on a page boundary and another
 * page may follow, while a short one can only be the end.
 *
 * The count MUST be of raw conversation rows (`sidebarConversationRow`), not the `/c/` ids the
 * loader collects. The same measurement found each page's 28 rows split between top-level and
 * project/GPT-scoped conversations in a ratio that varies per page, so the `/c/` increment
 * alone came out anywhere from 15 to 27 — which is exactly why this oracle looked impossible
 * from the numbers the loader already had.
 *
 * A batch is judged only once it has **settled** — the rows are accumulated while the count is
 * still growing and classified on the first round that adds nothing. Judging each round's delta
 * on its own would be wrong in the one direction that matters: anchors lag their rows mid-fetch
 * (measured 2026-07-28 — 1039 `li` against 1036 anchors), so a full page sampled during
 * hydration reads as a short one, and "short ⇒ exhausted" firing on that sample would recreate
 * the very truncation this guard exists to prevent.
 *
 * Read the evidence for what it is: **asymmetric**. A short increment proves the end; a
 * full-size one does not prove more is coming (a list whose length is an exact multiple of the
 * page size ends on a full-size page). Callers must therefore bound how long they act on it —
 * see `SIDEBAR_PENDING_EXTRA_ROUNDS`. The page size is derived from the largest increment
 * actually observed rather than hardcoded to 28: that number is one account's reading of a
 * server-side constant on one day, and a stale hardcode would silently stop the gate firing.
 * Stays `false` until a page has been seen at all, so a history shorter than one page — where
 * no increment is ever observed — never claims a page is owed.
 */
function pageParityGate(
  rowCount: () => number,
  { knownPageSize = 0, onPageSize }: { knownPageSize?: number; onPageSize?: (size: number) => void } = {},
): () => boolean {
  let previousRows = -1;
  let pageSize = knownPageSize;
  let pending = false;
  let batch = 0;
  return () => {
    const rows = rowCount();
    if (previousRows < 0) {
      // With no size handed in, seed from the rows already rendered when the walk starts, which
      // live measurement recorded as exactly one page (`28 (initial render) + 36 × 28 + 6 =
      // 1042`). Without a seed the FIRST increment would always define the size and so always
      // satisfy the test below — so a history holding one short final page beyond the initial
      // render would warn on every single load, complete or not.
      //
      // That seed only holds on a FRESH sidebar. On a re-run over an already-loaded list (the
      // retry the incomplete warning invites) the rendered rows are the whole accumulated list,
      // far larger than a page, so no increment could ever match and the gate would go quiet —
      // leaving the retry on the bare dwell exactly when a page is most likely still owed. A
      // caller that has seen a page land therefore passes `knownPageSize` back in, and it takes
      // precedence over the seed: measured evidence over a positional assumption.
      //
      // An empty sidebar seeds 0, which is no evidence at all; the `established` test below
      // then withholds a verdict until an increment has actually set the size.
      if (pageSize === 0) pageSize = rows;
    } else if (rows > previousRows) {
      // Still arriving — accumulate, do not judge yet (see the settling note above).
      batch += rows - previousRows;
    } else if (batch > 0) {
      // Growth stopped, so the batch is whole and can finally be classified.
      const known = pageSize; // the size in force BEFORE this batch can redefine it, below
      const established = known > 0;
      if (batch > pageSize) pageSize = batch;
      pending = established && batch === pageSize;
      // Report only a size this batch MATCHED — never one it defined. A batch that grew the
      // size is the gate's own guess at what a page is worth: an empty or half-rendered
      // sidebar seeds under a page, and two pages coalescing into one settled batch reads as
      // double. Both are fine to act on locally (`pending` above, this walk only), but the
      // caller caches what lands here for the page's whole lifetime, and `knownPageSize` then
      // outranks the seed — so a guess cached once would cost every later retry its oracle
      // with no way to self-heal. A short batch never matches either, so what a caller can be
      // handed is only ever evidence.
      if (established && batch === known) onPageSize?.(known);
      batch = 0;
    }
    previousRows = rows;
    return pending;
  };
}

/**
 * Repeatedly pin `container`'s scroll position and wait, until the list is judged fully
 * loaded. A round counts as **progress** — resetting the stall counter — when either:
 *
 * - `count` grew: more items rendered; or
 * - `settled(container)` is false: the walk has not yet reached the end of the list, so a
 *   run of item-less windows (date dividers, non-`/c/` rows, a page that landed below the
 *   viewport) can never be mistaken for the end of a lazy list. This is what separates "no
 *   new items" from "still fetching" structurally: once a page lands the container scrolls
 *   further again, so only a genuinely exhausted list ever accumulates stalls.
 *
 * `settled` is called once per round *before* the pin, so it observes where the previous
 * round's pin landed. Only a settled, static list accumulates stalls, and only `stableRounds`
 * of those in a row end the loop. `settled` defaults to always-true, preserving the message
 * viewport's count-stability-only rule: that path pins to the *top*, where `scrollTop` is not a usable
 * completion signal (the user or browser may leave it off the pinned edge), so judging it by
 * position would falsely fail a fully-loaded conversation. Only the absolute step cap
 * (reached solely if items never stop appearing) is a fail-loud condition (AGENTS.md #4).
 */
async function scrollUntilStable(
  container: HTMLElement,
  count: () => number,
  pin: (container: HTMLElement) => void,
  options: AutoScrollOptions,
  {
    timeoutMessage,
    settled = () => true,
    pending = () => false,
    pendingExtraRounds = 0,
    defaults = {},
    onProgress,
    onIncomplete,
  }: {
    timeoutMessage: string;
    settled?: (container: HTMLElement) => boolean;
    /**
     * Structural evidence that the list is not finished even though nothing is arriving —
     * `pageParityGate`. Defaults to "no evidence", leaving the message-viewport walk (which
     * has no page structure to read) on the stall counter alone.
     */
    pending?: () => boolean;
    /** Extra stall rounds allowed while `pending()` holds. */
    pendingExtraRounds?: number;
    defaults?: AutoScrollOptions;
    /** Fired with `count()`'s value, but only on a round that actually grew it. */
    onProgress?: (count: number) => void;
    /** Fired once if the loop gave up while `pending()` still held. */
    onIncomplete?: () => void;
  },
): Promise<void> {
  const {
    stepDelayMs = defaults.stepDelayMs ?? SCROLL_STEP_DELAY_MS,
    stableRounds = defaults.stableRounds ?? SCROLL_STABLE_ROUNDS,
    maxSteps = defaults.maxSteps ?? SCROLL_ABSOLUTE_MAX_STEPS,
  } = options;

  let lastCount = -1;
  let stalls = 0;
  for (let step = 0; step < maxSteps; step++) {
    const current = count();
    // Consulted every round, never short-circuited past: `settled` may be stateful
    // (`endOfListGate` compares against the position it saw last round), so skipping the
    // call on a round where the count grew would leave it reading a stale position.
    const stillScrolling = !settled(container);
    // Likewise stateful (it diffs against the row count it saw last round), so it is consulted
    // every round rather than only on the rounds where its answer is used.
    const morePagesOwed = pending();
    if (current > lastCount || stillScrolling) {
      if (current > lastCount) onProgress?.(current); // Report only genuine new-row rounds.
      stalls = 0; // Progress, or not yet at the end of the list — keep going.
    } else {
      stalls++;
      // Settled and static for a while → fully loaded, unless parity says a page is still
      // owed, which buys a longer (but still bounded) wait before giving up.
      if (stalls >= stableRounds + (morePagesOwed ? pendingExtraRounds : 0)) {
        if (morePagesOwed) onIncomplete?.();
        return;
      }
    }
    lastCount = current;
    pin(container);
    await delay(stepDelayMs);
  }

  // Reached the absolute cap while items were still appearing every few rounds: the
  // list is longer than we can safely load in one pass. Fail loud rather than return
  // a silent partial.
  throw new ExtractionError(timeoutMessage);
}

