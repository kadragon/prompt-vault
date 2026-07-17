import type { Conversation, Message, Role } from '../../core/conversation';
import type { SidebarConversation } from '../../core/sidebar';
import { ExtractionError } from '../../core/errors';
import type { ConversationAdapter, OpenConversationOptions } from '../types';
import { htmlToMarkdown } from './html-to-markdown';
import { matches } from './matches';
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

/** Split a `/c/<id>` sidebar href into its stable path id and a query-free absolute URL. */
function resolveConversationHref(href: string, origin: string): { id: string; url: string } {
  try {
    const parsed = new URL(href, origin);
    const match = parsed.pathname.match(/\/c\/([^/?#]+)/);
    return { id: match ? match[1] : '', url: origin + parsed.pathname };
  } catch {
    return { id: '', url: '' };
  }
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
  const {
    stepDelayMs = SCROLL_STEP_DELAY_MS,
    stableRounds = SCROLL_STABLE_ROUNDS,
    maxSteps = SCROLL_ABSOLUTE_MAX_STEPS,
  } = options;

  const container = doc.querySelector<HTMLElement>(selectors.scrollContainer);
  if (!container) return; // Best-effort: extract whatever is already present.

  let lastCount = -1;
  let stalls = 0;
  for (let step = 0; step < maxSteps; step++) {
    const count = doc.querySelectorAll(selectors.message).length;
    if (count > lastCount) {
      stalls = 0; // Progress: more older turns rendered — keep going.
    } else {
      stalls++;
      if (stalls >= stableRounds) return; // No new turns for a while → fully loaded.
    }
    lastCount = count;
    container.scrollTop = 0;
    await delay(stepDelayMs);
  }

  // Reached the absolute cap while turns were still appearing every few rounds: the
  // conversation is longer than we can safely load in one pass. Fail loud rather
  // than return a silent partial.
  throw new ExtractionError(
    'Timed out loading the full conversation while scrolling. The conversation may be ' +
      'unusually long; try again, or report if this persists.',
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
