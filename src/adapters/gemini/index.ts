import type { Conversation, Message } from '../../core/conversation';
import { ExtractionError } from '../../core/errors';
import { htmlToMarkdown } from '../../core/html-to-markdown';
import type { ConversationAdapter } from '../types';
import { matches } from './matches';
import { LRM, selectors, TITLE_SUFFIX } from './selectors';

const PROVIDER = 'gemini';

// Walk tuning for Gemini's lazily-paged exchange list. A fresh page load renders only the
// newest 10 exchanges and the older ones arrive in batches as the walk approaches the top of
// the loaded range (verified live 2026-07-25), so extraction has to scroll up before it can
// read. Unlike Claude, nothing is ever trimmed once loaded — which is why the walk here only
// has to REACH the top, not record on the way (see `collectPagedExchanges`).
//
// The delay is deliberately longer than the Claude adapter's 150 ms render frame: a batch of
// older exchanges is a data load, not a re-layout. It was not timed directly — the one batch
// observed landed inside a single 350 ms round — so this is sized against the only comparable
// number this repo has measured, ChatGPT's `#history` pages at 1418–2830 ms each
// (docs/live-dom-verification.md), and deliberately errs slow.
const SCROLL_STEP_DELAY_MS = 500;
// Advance half a viewport per step, so a batch that loads mid-walk cannot be skipped past.
const WALK_STEP_FRACTION = 0.5;
// Consecutive QUIET rounds at the top before the list counts as fully loaded — see
// `walkToTop` for what "quiet" means and why position alone is not enough. Six rounds at the
// delay above is ~3 s, chosen to exceed the slowest comparable page load measured in this
// repo (2830 ms) rather than the one fast sample seen on Gemini itself.
const END_SETTLE_ROUNDS = 6;
// Hard anti-runaway ceiling, far above any real conversation's step count (the primary bound
// is derived from the live scroll height each iteration).
const WALK_ABSOLUTE_MAX_STEPS = 2000;

// Gemini's own icon-button classes, taken verbatim from the native header text-to-speech
// button (verified live 2026-07-25). Three tokens are dropped, each because it is wrong for
// THESE buttons rather than merely unused:
//   - `tts-button` — the text-to-speech control's own identity class.
//   - `mat-mdc-tooltip-trigger` — applied by Angular Material's tooltip directive, which
//     these buttons do not use; carrying it would claim a behavior that is not wired up.
//   - `ng-star-inserted` — an Angular runtime marker stamped on elements the framework
//     created. Nothing styles it, and it is a lie on a node we inserted ourselves.
// The Material state/ripple tokens are KEPT: `runExport` (src/content/mount.ts) sets
// `disabled` on every button for the duration of an export, and on Gemini that export is a
// scroll walk lasting seconds — the native disabled styling is the only in-flight feedback
// the user gets.
//
// Owned by the adapter (not the content layer) to keep provider CSS knowledge here; if
// Gemini renames these tokens the buttons degrade to unstyled-but-functional.
const TOOLBAR_BUTTON_CLASS =
  'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-unthemed';

/**
 * Gemini adapter — single-conversation export only. Every other `ConversationAdapter`
 * member is optional and deliberately unimplemented: the sidebar bulk track and the Gems /
 * projects track would each need their own live-DOM verification, and an unverified
 * implementation is worse than an absent one (AGENTS.md #5).
 *
 * Absence alone is not enough to hide a feature, though — the content layer has to *read*
 * it. `syncConversationButtons` gates the bulk icon on `listConversations` +
 * `openConversation` being present, and `pickProjectAdapter` gates the project trigger on
 * `matchesProject`.
 */
export const geminiAdapter: ConversationAdapter = {
  provider: PROVIDER,
  matches,
  extract,
  toolbarMount,
  toolbarButtonClass: TOOLBAR_BUTTON_CLASS,
  toolbarAnchor,
};

/**
 * The conversation header's right-hand action group — the injection point for the export
 * buttons. All Gemini DOM knowledge lives in this adapter (docs/conventions.md), so the
 * content layer asks for the mount point instead of hardcoding a selector. Null when the
 * header has not rendered yet or the markup changed; the caller then falls back to a
 * non-overlapping overlay.
 */
function toolbarMount(root: ParentNode = document): Element | null {
  return root.querySelector(selectors.headerActions);
}

/**
 * The native text-to-speech control — the export buttons are placed immediately to its left,
 * beside the native controls rather than after them. Gemini has no Share button, so this is
 * the leftmost native control in the group. Null when it has not rendered; the content layer
 * then mounts at the front of the bar.
 */
function toolbarAnchor(root: ParentNode = document): Element | null {
  return root.querySelector(selectors.ttsControl);
}

/** Overridable knobs so the walk can be unit-tested without real timers. */
export interface WalkOptions {
  /** Milliseconds to wait after each scroll step before re-reading the DOM. */
  stepDelayMs?: number;
  /** Absolute step cap; exceeding it before reaching the top fails loud. */
  maxSteps?: number;
}

export async function extract(root: ParentNode = document, options: WalkOptions = {}): Promise<Conversation> {
  // On the live page Gemini withholds older exchanges until the list is scrolled up, so a
  // single `querySelectorAll` sees only the newest 10 (verified live 2026-07-25 — a
  // 16-exchange conversation rendered 10 on load). Walk first, then read. Fixture roots are
  // fully materialized and have no scroll port, so they use the one-shot read.
  const messages =
    root === (globalThis as { document?: Document }).document
      ? await collectPagedExchanges(root as Document, options)
      : readSnapshot(root);

  if (messages.length === 0) {
    throw new ExtractionError(
      'No messages found on the page. The conversation may not have loaded, or Gemini’s ' +
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
 * Read the whole conversation off the live, lazily-paged exchange list: scroll the list to
 * the top so every withheld exchange loads, then read them all once in document order.
 *
 * The single ordered read at the end is what makes this adapter simpler than the Claude one,
 * and it rests on a measured fact rather than an assumption: Gemini's list is **append-only**
 * — rows are added as the walk climbs and never trimmed (verified live 2026-07-25: a 35-round
 * up-then-down walk held the full rendered count on every round, and after a fresh load grew
 * 10 → 16 it never fell). So at the end of the walk the DOM holds every exchange.
 *
 * Accumulating across rounds — the Claude approach — would in fact be *worse* here: Gemini's
 * only per-exchange identity is an opaque hex `id`, so a map keyed by it could dedupe but
 * could never restore conversation order. Document order is the only ordering Gemini gives.
 *
 * The append-only premise is nevertheless GUARDED rather than trusted, because it was measured
 * at 11 and 16 exchanges and a recycling window could appear at a larger scale: if the final
 * read yields fewer exchanges than the most this walk ever saw at once, rows were dropped and
 * extraction fails loud instead of exporting the remainder (AGENTS.md #4).
 *
 * Falls back to a one-shot snapshot when there is no scroll container, or when it has zero
 * height (a hidden/background tab never scrolls, so the walk would crawl to the step cap).
 */
export async function collectPagedExchanges(doc: Document, options: WalkOptions = {}): Promise<Message[]> {
  const container = doc.querySelector<HTMLElement>(selectors.scrollContainer);
  if (!container || container.clientHeight === 0) return readSnapshot(doc);

  const { stepDelayMs = SCROLL_STEP_DELAY_MS } = options;
  const stepPx = Math.max(1, Math.floor(container.clientHeight * WALK_STEP_FRACTION));

  // The walk drags the viewport across the whole conversation. Put the user back where they
  // were reading — including on the fail-loud paths, so a failed export does not also cost
  // them their place.
  const restoreScrollTop = container.scrollTop;
  try {
    const seen = await walkToTop(doc, container, stepDelayMs, options.maxSteps, stepPx);
    if (!seen.reachedTop) {
      throw new ExtractionError(
        'Timed out scrolling back to the start of the conversation. It may be unusually ' +
          'long; try again, or report if this persists.',
      );
    }
    return readSnapshot(doc, seen.maxRendered);
  } finally {
    container.scrollTop = restoreScrollTop;
  }
}

/** What the upward walk observed: whether it settled at the top, and the most exchanges rendered at once. */
interface WalkResult {
  reachedTop: boolean;
  maxRendered: number;
}

/**
 * Step the exchange list up to its first exchange, and keep going until the list stops
 * changing there.
 *
 * The settle condition is deliberately NOT "scrollTop is 0". Reaching the top of the
 * currently-loaded range is precisely what *triggers* the next batch of older exchanges
 * (verified live 2026-07-25: the rendered count went 10 → 16 and `scrollHeight` 5019 → 9129
 * in one round as the walk neared the top), so stopping on position would return a
 * plausible-looking partial conversation. A round only counts as quiet when the walk is at
 * the top AND the scroll height AND the rendered count are both unchanged from the previous
 * round; `END_SETTLE_ROUNDS` consecutive quiet rounds mean nothing more is arriving.
 *
 * That dwell is the ONLY completeness bound this provider offers: Gemini declares no total
 * (no `aria-setsize` anywhere) and its exchange ids are opaque, so there is nothing to check
 * a collected set against. A batch slower than the dwell would still truncate silently — the
 * same residual hazard the ChatGPT sidebar loaders carry, recorded in
 * docs/live-dom-verification.md rather than papered over.
 *
 * The step cap is derived from the scroll height, recomputed each round so a list that grows
 * as it pages in is not cut short, while a stuck container still terminates. It is taken from
 * the LARGEST height seen rather than the current one: a height that shrinks mid-walk (the
 * list dropping rows it had already loaded) would otherwise pull the cap below the distance
 * already travelled and abort as a timeout — masking that shortfall behind the wrong error,
 * and hiding it from the guard in `collectPagedExchanges` that exists to name it.
 */
async function walkToTop(
  doc: Document,
  container: HTMLElement,
  stepDelayMs: number,
  maxSteps: number | undefined,
  stepPx: number,
): Promise<WalkResult> {
  let maxRendered = 0;
  let maxHeight = 0;
  let quietRounds = 0;
  let lastHeight = -1;
  let lastCount = -1;

  for (let step = 0; ; step++) {
    const count = doc.querySelectorAll(selectors.exchange).length;
    const height = container.scrollHeight;
    if (count > maxRendered) maxRendered = count;
    if (height > maxHeight) maxHeight = height;

    const unchanged = height === lastHeight && count === lastCount;
    if (container.scrollTop <= 0 && unchanged) {
      if (++quietRounds >= END_SETTLE_ROUNDS) return { reachedTop: true, maxRendered };
    } else {
      quietRounds = 0;
    }
    lastHeight = height;
    lastCount = count;

    const cap = maxSteps ?? Math.ceil(maxHeight / stepPx) + END_SETTLE_ROUNDS + 5;
    if (step >= cap || step >= WALK_ABSOLUTE_MAX_STEPS) return { reachedTop: false, maxRendered };

    container.scrollTop = Math.max(0, container.scrollTop - stepPx);
    await delay(stepDelayMs);
  }
}

/**
 * Read every exchange currently in `root`, in document order, into the normalized message
 * list. Used both for fixtures (fully materialized, no scroll port) and as the final read of
 * the live walk — `minExpected` is how many exchanges the walk saw rendered at once, and a
 * shortfall against it means rows were trimmed after all (see `collectPagedExchanges`).
 */
function readSnapshot(root: ParentNode, minExpected = 0): Message[] {
  assertNotStreaming(root);

  const exchanges = Array.from(root.querySelectorAll(selectors.exchange));
  if (exchanges.length < minExpected) {
    throw new ExtractionError(
      `Only ${exchanges.length} of ${minExpected} loaded messages are still on the page — ` +
        'Gemini removed some while they were being read. Scroll through the whole ' +
        'conversation and try again.',
    );
  }

  const messages: Message[] = [];
  for (const exchange of exchanges) messages.push(...readExchange(exchange));
  return messages;
}

/**
 * Fail loud while a response is still being generated, rather than exporting the fragment
 * rendered so far (AGENTS.md #4). Gemini marks the growing prose container
 * `aria-busy="true"` and flips it to `"false"` when the answer is complete — and it stays
 * `true` for a beat AFTER the text stops growing (verified live 2026-07-25), so it catches
 * pauses that a "has the content changed?" heuristic would read as finished.
 *
 * Checked before the walk as well as on the final read: before, so a user who clicks export
 * mid-answer is told immediately instead of after a scroll walk; again after, so an answer
 * that *started* during the export cannot slip into the output half-written.
 */
function assertNotStreaming(root: ParentNode): void {
  for (const markdown of Array.from(root.querySelectorAll(selectors.assistantMarkdown))) {
    if (markdown.getAttribute(selectors.streamingAttr) === 'true') {
      throw new ExtractionError(
        'Gemini is still generating a response. Wait for it to finish, then export again.',
      );
    }
  }
}

/**
 * One exchange → its messages, user side first. Gemini wraps a prompt and its reply in a
 * single container (there is no per-message element), so document order within the container
 * is the interleaving. Verified live 2026-07-25: exactly one `user-query` and one
 * `model-response` per container, 16/16.
 *
 * Every failure here is loud, because each is a message we can see but cannot read:
 * - a container with neither half — markup this adapter does not understand;
 * - a `user-query` that yields no content;
 * - a `model-response` whose prose container is missing or empty.
 *
 * A container holding a prompt and NO `model-response` is not a failure: that is an exchange
 * whose answer was stopped or never started, and exporting the prompt alone drops nothing.
 */
function readExchange(exchange: Element): Message[] {
  const messages: Message[] = [];

  const query = exchange.querySelector(selectors.userQuery);
  if (query) {
    const content = readUserContent(query);
    if (!content) throw unreadableExchangeError();
    messages.push({ role: 'user', content });
  }

  const response = exchange.querySelector(selectors.modelResponse);
  if (response) {
    const content = readAssistantContent(response);
    if (!content) throw unreadableExchangeError();
    messages.push({ role: 'assistant', content });
  }

  if (messages.length === 0) throw unreadableExchangeError();
  return messages;
}

function unreadableExchangeError(): ExtractionError {
  return new ExtractionError(
    'Some conversation turns could not be read (empty or malformed). The conversation may ' +
      'still be loading — wait for it to finish, then try again.',
  );
}

/**
 * The user's prompt as typed. Read from the per-line `p.query-text-line` elements rather
 * than the block's `textContent`, because Gemini renders an Angular Material screen-reader
 * label inside that block — a naive read came back as `"말씀하신 내용 <the prompt>"` live
 * (2026-07-25), which would have been exported as part of the user's own words.
 *
 * Lines are joined with single newlines: they are rendered lines of one prompt, not separate
 * paragraphs. Only the single-line case was measurable (Gemini's composer rejected every
 * synthetic attempt to type a newline), so this deliberately does not depend on the number
 * of line elements — it joins however many exist and otherwise falls back to the block's own
 * text with the label stripped, which is right whether a multi-line prompt turns out to be
 * N line elements or one element with `<br>`s. Tracked as a `[VERIFY]` in tasks.md.
 */
function readUserContent(query: Element): string {
  const scope = query.querySelector(selectors.userQueryText) ?? query;

  const lines = Array.from(scope.querySelectorAll(selectors.userQueryLine))
    .map((line) => (line.textContent ?? '').trim())
    .filter(Boolean);
  if (lines.length > 0) return lines.join('\n');

  const fallback = textWithoutScreenReaderLabel(scope);
  if (fallback) return fallback;

  // A prompt holding only a pasted image has no readable text node. Describe it rather than
  // yielding empty — an empty turn fails the WHOLE export, so one image-only message would
  // block the conversation entirely. `img` is a standard tag, not a guessed Gemini selector.
  //
  // Narrower than "attachments are handled": no user turn carrying a file or image was
  // captured in the measured conversations (`user-query img` was 0 throughout), so how
  // Gemini renders an attachment tile — and whether it sits inside `user-query` at all — is
  // unknown and tracked as a `[VERIFY]`. Guessing at a tile selector would risk reporting a
  // fabricated file name (AGENTS.md #5).
  if (scope.querySelector('img')) return '[Image]';
  return '';
}

/** The element's text with the screen-reader-only label removed, trimmed. */
function textWithoutScreenReaderLabel(scope: Element): string {
  const clone = scope.cloneNode(true) as Element;
  for (const label of Array.from(clone.querySelectorAll(selectors.screenReaderLabel))) {
    label.remove();
  }
  return (clone.textContent ?? '').trim();
}

/**
 * The model's reply as Markdown. Gemini's response chrome (sources, thinking overlay, the
 * feedback action bar) lives OUTSIDE the prose container, so serializing that container
 * needs no filtering — with the one exception normalized below.
 */
function readAssistantContent(response: Element): string {
  const markdown = response.querySelector(selectors.assistantMarkdown);
  if (!markdown) return '';
  // Serialize a CLONE: the normalization below mutates the tree, and the live page is the
  // user's, not ours to rewrite.
  const clone = markdown.cloneNode(true) as Element;
  normalizeCodeBlocks(clone);
  return htmlToMarkdown(clone);
}

/**
 * Make Gemini's code blocks legible to the provider-agnostic serializer, which is the reason
 * this normalization lives in the adapter rather than in core (AGENTS.md #3).
 *
 * Gemini renders the language as a header label in a `div.code-block-decoration` that is a
 * **sibling** of the `<pre>`, and tags no `language-*` class on the `<code>` (verified live
 * 2026-07-25: `class="code-container formatted …"`, with the label reading "Python" / "JSON"
 * / "Markdown"). `codeLanguage()` in core reads the class and otherwise looks *inside* the
 * `<pre>`, so it sees neither — and worse, the label being an ordinary sibling element means
 * the serializer would emit "Python" as a paragraph of prose above the fence.
 *
 * So: copy the label onto the `<code>` as a `language-…` class, then delete the label and the
 * copy-button row. The token is only lowercased here, not validated — core's
 * `languageFromClass` already rejects anything that is not language-shaped, so a label that
 * is not a language yields an unlabelled fence rather than a bogus one. Whether this element
 * can ever hold something OTHER than a language name is not established: it held exactly the
 * language in every measured block, and one block had no decoration at all (an absent label
 * is normal, not an anomaly).
 */
function normalizeCodeBlocks(root: Element): void {
  for (const block of Array.from(root.querySelectorAll(selectors.codeBlock))) {
    const label = block.querySelector(selectors.codeLanguageLabel);
    const code = block.querySelector('code');
    const token = (label?.textContent ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const existing = code?.getAttribute('class') ?? '';
    if (token && code && !/(^|\s)language-/.test(existing)) {
      code.setAttribute('class', `${existing} language-${token}`.trim());
    }
    label?.remove();
    for (const buttons of Array.from(block.querySelectorAll(selectors.codeBlockButtons))) {
      buttons.remove();
    }
  }
}

/**
 * The conversation title from `document.title`, which Gemini formats as
 * `"<conversation title> - Google Gemini"` (verified live 2026-07-25). The left-to-right mark
 * Gemini prefixes while loading is stripped first — it is invisible, so a comparison that
 * left it in place would silently fail to recognize the untitled state. A bare
 * `Google Gemini` means no conversation title has been assigned yet.
 */
function deriveTitle(root: ParentNode): string {
  const raw = (ownerDocument(root)?.title ?? '').split(LRM).join('').trim();
  const title = raw.endsWith(TITLE_SUFFIX) ? raw.slice(0, -TITLE_SUFFIX.length).trim() : raw;
  return title && title !== 'Google Gemini' ? title : 'Gemini conversation';
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
