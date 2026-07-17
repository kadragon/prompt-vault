import type { Conversation, Message, Role } from '../../core/conversation';
import { ExtractionError } from '../../core/errors';
import type { ConversationAdapter } from '../types';
import { htmlToMarkdown } from './html-to-markdown';
import { matches } from './matches';
import { selectors } from './selectors';

const PROVIDER = 'chatgpt';

// Auto-scroll tuning. ChatGPT virtualizes the message list and lazy-renders older
// turns as you scroll toward the top, so we scroll up repeatedly until the set of
// rendered messages stops growing (stable) — or we hit the step cap (fail-loud).
const SCROLL_STEP_DELAY_MS = 150;
const SCROLL_MAX_STEPS = 60;
const SCROLL_STABLE_ROUNDS = 3;

export const chatgptAdapter: ConversationAdapter = {
  provider: PROVIDER,
  matches,
  extract,
};

async function extract(root: ParentNode = document): Promise<Conversation> {
  // Auto-scroll only makes sense against the live document; fixture roots are
  // fully materialized already.
  if (root === (globalThis as { document?: Document }).document) {
    await autoScrollToLoad(root as Document);
  }

  const messageEls = Array.from(root.querySelectorAll(selectors.message));
  const messages = messageEls.map(toMessage).filter((m): m is Message => m !== null);

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

/** Map one message DOM node to a normalized Message, or null if it has no content. */
function toMessage(el: Element): Message | null {
  const role = el.getAttribute(selectors.authorRoleAttr) as Role | null;
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return null;

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
 * Scroll the message viewport to the top in bounded steps to force ChatGPT to
 * render lazily-loaded older turns, stopping once the rendered-message count is
 * stable across a few rounds. A scroll that never stabilizes within the step cap
 * is treated as a fail-loud condition (AGENTS.md #4) rather than a silent partial.
 */
async function autoScrollToLoad(doc: Document): Promise<void> {
  const container = doc.querySelector<HTMLElement>(selectors.scrollContainer);
  if (!container) return; // Best-effort: extract whatever is already present.

  let lastCount = -1;
  let stableRounds = 0;
  for (let step = 0; step < SCROLL_MAX_STEPS; step++) {
    const count = doc.querySelectorAll(selectors.message).length;
    const atTop = container.scrollTop === 0;
    if (count === lastCount) {
      stableRounds++;
      // Fully loaded: the rendered-message count held steady while pinned at the
      // top, so there are no more lazy older turns to pull in.
      if (stableRounds >= SCROLL_STABLE_ROUNDS && atTop) return;
    } else {
      stableRounds = 0;
    }
    lastCount = count;
    container.scrollTop = 0;
    await delay(SCROLL_STEP_DELAY_MS);
  }

  // Hit the step cap without the count ever stabilizing at the top: older turns
  // are still loading, so we cannot guarantee the full history. Fail loud rather
  // than return a silent partial (AGENTS.md #4). Note scrollTop is not a reliable
  // signal here — it is forced to 0 every iteration — so completion is decided by
  // count-stability above, and reaching this line means we never got there.
  throw new ExtractionError(
    'Timed out loading the full conversation while scrolling. The conversation may be ' +
      'unusually long; try again, or report if this persists.',
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
