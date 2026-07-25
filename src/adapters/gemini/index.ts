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
// Hard anti-runaway ceiling on total rounds, far above any real conversation's count (the
// primary bounds are the travel cap and the stall cap below).
const WALK_ABSOLUTE_MAX_STEPS = 2000;
// Spare travel steps beyond the distance the walk has to cover, absorbing rounding and a
// re-render that shifts the position slightly. Waiting for a batch is NOT charged here — see
// `walkToTop`, where only rounds that moved or grew the list consume travel budget.
const TRAVEL_SLACK_STEPS = 10;
// Rounds the list may go completely inert — no scroll movement AND no growth — before the walk
// gives up. This is what catches a container that refuses to scroll at all; at the default step
// delay it is 20 s, far above the slowest comparable page load this repo has measured
// (ChatGPT's `#history` at 2830 ms). It is reset by any movement or growth, so a conversation
// that pages in slowly is never cut short by it.
const MAX_STALL_ROUNDS = 40;
// Treat a scroll position within this many pixels of 0 as "at the top". Defensive, not measured:
// the live walk reached exactly 0 (docs/live-dom-verification.md → Gemini re-probe), but a
// fractional `scrollTop` — browser zoom, a fractional device pixel ratio, a scroll-snap that
// refuses the last pixel — would otherwise make `<= 0` unsatisfiable and fail every export on
// such a display. It cannot weaken the stuck-container guard, which sits thousands of pixels away.
const AT_TOP_EPSILON_PX = 1;
// Exchanges a fresh page load renders before any scrolling — verified live 2026-07-25 on
// conversations of 11, 16 and 17 exchanges, every one of which rendered exactly 10.
//
// Used ONLY as a safety threshold on the unwalkable path (`readUnwalkable`): a page holding
// fewer than this cannot be hiding older exchanges, because a load renders `min(pageSize, total)`.
// Nothing else depends on the number, and a Gemini change to it errs toward failing loud rather
// than toward a silent partial.
const INITIAL_PAGE_SIZE = 10;

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
 * When the list cannot be walked at all, `readUnwalkable` decides whether a one-shot read is
 * safe — it usually is not.
 */
export async function collectPagedExchanges(doc: Document, options: WalkOptions = {}): Promise<Message[]> {
  const container = doc.querySelector<HTMLElement>(selectors.scrollContainer);
  if (!container || container.clientHeight === 0) return readUnwalkable(doc, container === null);

  // Before the walk, not only on the final read: on a long conversation the walk takes seconds
  // to minutes with every export button disabled, and telling the user "wait for the response
  // to finish" only afterwards wastes all of it.
  assertNotStreaming(doc);

  const { stepDelayMs = SCROLL_STEP_DELAY_MS } = options;
  const stepPx = Math.max(1, Math.floor(container.clientHeight * WALK_STEP_FRACTION));

  // The walk drags the viewport across the whole conversation. Put the user back where they
  // were reading — including on the fail-loud paths, so a failed export does not also cost them
  // their place.
  //
  // Restore the distance from the BOTTOM, not the absolute offset. Paging inserts older
  // exchanges ABOVE the reader and grows `scrollHeight` (live: 5019 → 10065 on a 17-exchange
  // conversation), so the message that was at offset X is afterwards at X + everything-prepended;
  // writing X back would drop the user thousands of pixels earlier in the conversation. Distance
  // from the bottom is invariant under prepending, which is the only growth this walk causes —
  // and content arriving at the bottom mid-export raises `aria-busy`, which fails the export.
  const restoreFromBottom = container.scrollHeight - container.scrollTop;
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
    container.scrollTop = Math.max(0, container.scrollHeight - restoreFromBottom);
  }
}

/**
 * The read for a page whose exchange list cannot be scrolled — the scroll-port selector matched
 * nothing, or the port has zero height (a hidden ancestor, a mid-route transition, a background
 * tab). Neither state can page in the older exchanges Gemini withholds, so completeness is
 * unknowable here, and a one-shot read would hand back the newest page as if it were the whole
 * conversation: the silent partial download AGENTS.md #4 forbids, on the one path in this adapter
 * where nothing else would catch it (Gemini declares no total, so there is no shortfall to
 * detect).
 *
 * Short conversations are still exportable, and that is not a compromise: a fresh load renders
 * `min(INITIAL_PAGE_SIZE, total)` exchanges, so a page holding FEWER than a full page cannot be
 * hiding any — the read is provably complete. At a full page or more it may or may not be, and
 * "may" is not good enough to export silently.
 */
function readUnwalkable(doc: Document, missingContainer: boolean): Message[] {
  const rendered = doc.querySelectorAll(selectors.exchange).length;
  if (rendered >= INITIAL_PAGE_SIZE) {
    throw new ExtractionError(
      missingContainer
        ? 'Could not find Gemini’s message list to scroll, so older messages in this ' +
          'conversation may not have loaded. Gemini’s markup may have changed — please report this.'
        : 'Gemini’s message list cannot be scrolled right now, so older messages in this ' +
          'conversation may not have loaded. Bring the conversation into view and try again.',
    );
  }
  return readSnapshot(doc);
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
 * Two independent budgets end a walk that is not progressing, and keeping them separate is the
 * point. **Travel** is bounded by the distance to cover — from the LARGEST scroll height seen,
 * not the current one, since a height that shrinks mid-walk (the list dropping rows it had
 * already loaded) would otherwise pull the cap below the distance already travelled and abort as
 * a timeout, masking that shortfall behind the wrong error and hiding it from the guard in
 * `collectPagedExchanges` that exists to name it. **Stalling** is bounded separately by
 * `MAX_STALL_ROUNDS`, reset by any movement or growth.
 *
 * Only rounds that moved the viewport or grew the list are charged to the travel budget. Rounds
 * spent WAITING for a batch cover no distance, and charging them to a distance-derived cap made
 * long conversations fail on healthy pages: the cap allowed a fixed ~13 spare rounds regardless
 * of length, the settle dwell always consumed 6 of them, and a conversation needing nine batches
 * at even two stall rounds each would exhaust the rest and report "timed out" with nothing wrong.
 * (Raised in review; the arithmetic is `ceil(maxHeight/stepPx) + 11` allowed against
 * `ceil(maxHeight/stepPx) - 2` needed to climb.) Waiting is now bounded only by the stall cap,
 * which is per-wait rather than per-walk.
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
  let travelSteps = 0;
  let stallRounds = 0;
  let lastHeight = -1;
  let lastCount = -1;
  let lastTop = -1;

  for (let round = 0; ; round++) {
    const count = doc.querySelectorAll(selectors.exchange).length;
    const height = container.scrollHeight;
    const top = container.scrollTop;
    if (count > maxRendered) maxRendered = count;
    if (height > maxHeight) maxHeight = height;

    const unchanged = height === lastHeight && count === lastCount;
    if (top <= AT_TOP_EPSILON_PX && unchanged) {
      if (++quietRounds >= END_SETTLE_ROUNDS) return { reachedTop: true, maxRendered };
    } else {
      quietRounds = 0;
    }

    // First round establishes the baseline; it can be neither progress nor a stall.
    const first = lastTop < 0;
    const moved = !first && Math.abs(top - lastTop) > AT_TOP_EPSILON_PX;
    const grew = !first && (height > lastHeight || count > lastCount);
    // Only MOVEMENT consumes the travel budget, because only movement covers distance. Growth is
    // progress — it proves a batch landed — so it clears the stall counter without being charged
    // to a budget derived from distance.
    if (moved) {
      travelSteps++;
      stallRounds = 0;
    } else if (grew) {
      stallRounds = 0;
    } else if (!first) {
      stallRounds++;
    }

    lastHeight = height;
    lastCount = count;
    lastTop = top;

    const travelCap = maxSteps ?? Math.ceil(maxHeight / stepPx) + TRAVEL_SLACK_STEPS;
    if (
      travelSteps >= travelCap ||
      stallRounds >= MAX_STALL_ROUNDS ||
      round >= WALK_ABSOLUTE_MAX_STEPS
    ) {
      return { reachedTop: false, maxRendered };
    }

    container.scrollTop = Math.max(0, top - stepPx);
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
      `Only ${exchanges.length} of ${minExpected} loaded exchanges are still on the page — ` +
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
 * Called twice on the live path, from `collectPagedExchanges` before the walk and from
 * `readSnapshot` on the final read. Before, so a user who clicks export mid-answer is told
 * immediately instead of after a walk that can run for minutes with the buttons disabled; again
 * after, so an answer that *started* during the export cannot slip into the output half-written.
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
 * Every failure here is loud, because each is a message we can see but cannot read. They are
 * split by whether retrying can possibly help, so the advice is never a dead end:
 * - a `model-response` with no prose container AT ALL — a shape this adapter does not know, so
 *   waiting will never clear it (`unreadableResponseError`);
 * - a prose container that is present but empty, or a `user-query` that yields no content —
 *   consistent with a half-rendered page, where retrying does help (`unreadableExchangeError`);
 * - a container with neither half — markup this adapter does not understand.
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
    if (content === null) throw unreadableResponseError();
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
 * A response that rendered no prose container at all. Deliberately worded differently from
 * `unreadableExchangeError`: this shape does not resolve by waiting, so telling the user the
 * conversation "may still be loading" would send them into a retry loop that can never clear.
 * Which shapes reach here is unmeasured — a generated image or a canvas/immersive panel are the
 * plausible candidates, and neither was present in the measured conversations — so it is tracked
 * as a `[VERIFY]` rather than guessed at with a selector (AGENTS.md #5).
 */
function unreadableResponseError(): ExtractionError {
  return new ExtractionError(
    'This conversation contains a response this extension could not read — it may be a kind ' +
      'Gemini renders outside its normal text area, or Gemini’s markup may have changed. ' +
      'Please report this.',
  );
}

/**
 * The user's prompt as typed. Read from the per-line `p.query-text-line` elements rather
 * than the block's `textContent`, because Gemini renders an Angular Material screen-reader
 * label inside that block — a naive read came back as `"말씀하신 내용 <the prompt>"` live
 * (2026-07-25), which would have been exported as part of the user's own words.
 *
 * A multi-line prompt renders one `p.query-text-line` per line, and **a blank line the user
 * typed is an EMPTY one holding a single `<br>`** — measured on two real prompts (2026-07-25:
 * 136 line elements of which 42 were empty with 42 `<br>`s; and 16 of which 4 were empty, all
 * four with a `<br>`). Those empties are what separate paragraphs, so they are kept: dropping
 * them (as an earlier revision did, via `.filter(Boolean)`) flattened every paragraph break in
 * the prompt — on the 136-line prompt, all 42 of them — turning the user's own words into one
 * undifferentiated block. Interior blanks survive; leading and trailing ones are trimmed off the
 * joined result, since they are padding rather than content.
 */
function readUserContent(query: Element): string {
  const scope = query.querySelector(selectors.userQueryText) ?? query;

  const lines = Array.from(scope.querySelectorAll(selectors.userQueryLine));
  if (lines.length > 0) {
    const text = lines
      .map((line) => (line.textContent ?? '').trim())
      .join('\n')
      .trim();
    if (text) return text;
  }

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
 *
 * Returns **null** when the response has no prose container at all, which is a different failure
 * from an empty one and gets a different error: see `readExchange`.
 */
function readAssistantContent(response: Element): string | null {
  const markdown = response.querySelector(selectors.assistantMarkdown);
  if (!markdown) return null;
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
