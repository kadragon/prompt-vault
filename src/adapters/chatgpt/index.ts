import type { Conversation, Message, Role } from '../../core/conversation';
import type { SidebarConversation } from '../../core/sidebar';
import { ExtractionError } from '../../core/errors';
import type { ConversationAdapter, OpenConversationOptions } from '../types';
import { htmlToMarkdown } from './html-to-markdown';
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

/** Overridable knobs so the loop can be unit-tested without real timers/DOM. */
export interface AutoScrollOptions {
  stepDelayMs?: number;
  stableRounds?: number;
  maxSteps?: number;
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

  const origin = documentOrigin(root);
  const seen = new Set<string>();
  const conversations: SidebarConversation[] = [];
  for (const anchor of history.querySelectorAll(selectors.sidebarConversationLink)) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    const { id, url } = resolveConversationHref(href, origin);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const title = (anchor.getAttribute('aria-label') ?? anchor.textContent ?? '').trim();
    conversations.push({ id, title: title || 'ChatGPT conversation', url });
  }
  return conversations;
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

  const origin = documentOrigin(root);
  const seen = new Set<string>();
  const conversations: SidebarConversation[] = [];
  for (const anchor of section.querySelectorAll(selectors.projectConversationLink)) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    const { id, url } = resolveConversationHref(href, origin);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const titleEl = anchor.querySelector(selectors.projectConversationTitle);
    const title = (titleEl?.textContent ?? anchor.textContent ?? '').trim();
    conversations.push({ id, title: title || 'ChatGPT conversation', url });
  }
  return conversations;
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

async function extract(root: ParentNode = document): Promise<Conversation> {
  // Auto-scroll only makes sense against the live document; fixture roots are
  // fully materialized already.
  if (root === (globalThis as { document?: Document }).document) {
    await autoScrollToLoad(root as Document);
  }

  // Only nodes carrying a recognized author role are real conversation turns.
  const roleNodes = Array.from(root.querySelectorAll(selectors.message)).filter(hasKnownRole);
  const messages = roleNodes.map(toMessage).filter((m): m is Message => m !== null);

  if (messages.length === 0) {
    throw new ExtractionError(
      'No messages found on the page. The conversation may not have loaded, or ChatGPT’s ' +
        'markup changed — extraction selectors need updating.',
    );
  }

  // A turn was present in the DOM but produced no content (empty/malformed, e.g. a
  // response still streaming). Fail loud rather than export a conversation that is
  // silently missing turns (AGENTS.md #4).
  if (messages.length < roleNodes.length) {
    throw new ExtractionError(
      'Some conversation turns could not be read (empty or malformed). The conversation may ' +
        'still be loading — wait for it to finish, then try again.',
    );
  }

  return {
    title: deriveTitle(root),
    provider: PROVIDER,
    url: deriveUrl(root),
    messages,
  };
}

function hasKnownRole(el: Element): boolean {
  const role = el.getAttribute(selectors.authorRoleAttr);
  return role === 'user' || role === 'assistant' || role === 'system';
}

/** Map one message DOM node to a normalized Message, or null if it has no content. */
function toMessage(el: Element): Message | null {
  const role = el.getAttribute(selectors.authorRoleAttr) as Role;
  const content = role === 'assistant' ? assistantContent(el) : userContent(el);
  if (!content.trim()) return null;

  const id = el.getAttribute(selectors.messageIdAttr);
  const message: Message = { role, content };
  if (id) message.id = id;
  return message;
}

function userContent(el: Element): string {
  // User turns are plain (already markdown-ish) text in a pre-wrap block.
  const textEl = el.querySelector(selectors.userText);
  return (textEl?.textContent ?? el.textContent ?? '').trim();
}

function assistantContent(el: Element): string {
  const markdownEl = el.querySelector(selectors.assistantMarkdown);
  // Fall back to plain text if the prose container is missing so a markup change
  // degrades to readable text rather than an empty message.
  return markdownEl ? htmlToMarkdown(markdownEl) : (el.textContent ?? '').trim();
}

function deriveTitle(root: ParentNode): string {
  const doc = ownerDocument(root);
  const title = doc?.title?.trim();
  return title && title !== 'ChatGPT' ? title : 'ChatGPT conversation';
}

function deriveUrl(root: ParentNode): string {
  return ownerDocument(root)?.defaultView?.location?.href ?? '';
}

const DOCUMENT_NODE = 9;

function ownerDocument(root: ParentNode): Document | null {
  // Detect a Document by nodeType rather than `instanceof Document` so this works
  // under any DOM implementation (live browser or a parsed test fixture).
  if ((root as Node).nodeType === DOCUMENT_NODE) return root as Document;
  return (root as Element).ownerDocument ?? null;
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

/**
 * Load every not-yet-rendered conversation in the virtualized history sidebar by
 * scrolling it to the bottom until the rendered link count holds steady, so the bulk
 * panel's re-scan sees the full list. Best-effort: resolves immediately when the
 * sidebar (or its scroll container) is absent. Fail-loud (AGENTS.md #4) only on the
 * runaway cap — links never stop appearing — mirroring `autoScrollToLoad`.
 */
export async function loadMoreConversations(root: ParentNode = document, options: AutoScrollOptions = {}): Promise<void> {
  const history = root.querySelector(selectors.sidebarHistory);
  if (!history) return;
  const container = findScrollableAncestor(history);
  if (!container) return;

  await scrollUntilStable(
    container,
    () => history.querySelectorAll(selectors.sidebarConversationLink).length,
    pinBottom,
    options,
    {
      timeoutMessage:
        'Timed out loading the conversation list while scrolling. The sidebar may be ' +
        'unusually long; try again, or report if this persists.',
    },
  );
}

/**
 * Like `loadMoreConversations`, but for a Project home page's virtualized conversation
 * list. Scrolls the list `<section>`'s scroll container to the bottom until the rendered
 * link count stabilizes. Best-effort when the list/container is absent; fail-loud on runaway.
 */
export async function loadMoreProjectConversations(
  root: ParentNode = document,
  options: AutoScrollOptions = {},
): Promise<void> {
  const section = projectListSection(root);
  if (!section) return;
  const container = findScrollableAncestor(section);
  if (!container) return;

  await scrollUntilStable(
    container,
    () => section.querySelectorAll(selectors.projectConversationLink).length,
    pinBottom,
    options,
    {
      timeoutMessage:
        'Timed out loading the project conversation list while scrolling. The list may be ' +
        'unusually long; try again, or report if this persists.',
    },
  );
}

/** Pin a virtualized scroll container to the top (loads older items above). */
function pinTop(container: HTMLElement): void {
  container.scrollTop = 0;
}

/** Pin a virtualized scroll container to the bottom (loads more items below). */
function pinBottom(container: HTMLElement): void {
  container.scrollTop = container.scrollHeight;
}

/**
 * Repeatedly pin `container`'s scroll position and wait, until the rendered item
 * `count` holds steady for `stableRounds` (i.e. no more lazy items appear). Progress
 * resets the stall counter, so an arbitrarily long list keeps loading as long as new
 * items keep arriving. Completion is judged by count stability alone — never by
 * `scrollTop`, which the user or browser may leave off the pinned edge — so a
 * fully-loaded list never falsely fails. Only the absolute step cap (reached solely if
 * items never stop appearing) is a fail-loud condition (AGENTS.md #4).
 */
async function scrollUntilStable(
  container: HTMLElement,
  count: () => number,
  pin: (container: HTMLElement) => void,
  options: AutoScrollOptions,
  { timeoutMessage }: { timeoutMessage: string },
): Promise<void> {
  const {
    stepDelayMs = SCROLL_STEP_DELAY_MS,
    stableRounds = SCROLL_STABLE_ROUNDS,
    maxSteps = SCROLL_ABSOLUTE_MAX_STEPS,
  } = options;

  let lastCount = -1;
  let stalls = 0;
  for (let step = 0; step < maxSteps; step++) {
    const current = count();
    if (current > lastCount) {
      stalls = 0; // Progress: more items rendered — keep going.
    } else {
      stalls++;
      if (stalls >= stableRounds) return; // No new items for a while → fully loaded.
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

/**
 * The nearest vertically-scrollable ancestor of `el` (inclusive) — the element whose
 * own overflow scrolls the virtualized list. Walks up returning the first with
 * `scrollHeight > clientHeight` and a scrollable `overflow-y` (when `getComputedStyle`
 * is available), falling back to `el` itself. Deliberately generic rather than a
 * hardcoded selector: the sidebar's scroll wrapper is not a stable, verified selector
 * and ChatGPT's markup shifts (AGENTS.md #5).
 */
function findScrollableAncestor(el: Element): HTMLElement | null {
  const view = ownerDocument(el)?.defaultView ?? null;
  let current: Element | null = el;
  while (current) {
    const node = current as HTMLElement;
    if (node.scrollHeight > node.clientHeight) {
      const overflowY = view?.getComputedStyle?.(node).overflowY;
      if (!overflowY || overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
        return node;
      }
    }
    current = current.parentElement;
  }
  return el as HTMLElement;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
