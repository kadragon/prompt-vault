import type { Conversation, Message } from '../../core/conversation';
import { ExtractionError } from '../../core/errors';
import { htmlToMarkdown } from '../../core/html-to-markdown';
import type { SidebarConversation } from '../../core/sidebar';
import type { ConversationAdapter, LoadMoreOptions, OpenConversationOptions } from '../types';
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
// conversations of 11, 16, 17 and 31 exchanges, every one of which rendered exactly 10. The
// 31-exchange point comes from the rendered-UI session, which drove the built extension itself
// rather than a copied probe.
//
// Used ONLY as a safety threshold on the unwalkable path (`readUnwalkable`): a page holding
// fewer than this cannot be hiding older exchanges, because a load renders `min(pageSize, total)`.
// Nothing else depends on the number.
//
// **The safety is one-directional, and this is the number to re-measure first when Gemini's
// markup moves.** If Gemini RAISES its page size (10 → 20), the threshold only over-triggers: a
// complete 15-exchange page trips `rendered >= 10` and fails loud — annoying, safe. If Gemini
// LOWERS it (10 → 5), the threshold under-triggers: a 12-exchange conversation renders 5, `5 >= 10`
// is false, and `readUnwalkable` returns a 5-of-12 snapshot — reopening exactly the silent partial
// the guard exists to prevent, with nothing left to detect it. No code fixes that asymmetry,
// because Gemini declares no total to check against (see docs/live-dom-verification.md → Gemini);
// the mitigation is that this constant is on the live re-verification checklist, not an assumption
// that any drift is harmless.
const INITIAL_PAGE_SIZE = 10;

// --- History-sidebar walk tuning. Separate from the exchange-list walk above: the sidebar is
// append-only SERVER paging (20 rows per page after an initial 31, nothing ever trimmed —
// verified live 2026-08-10), while the message list pages older turns in on scroll-UP.

// Advance ~one viewport per round. Nothing is recycled off the top of this list, so a round that
// overshoots cannot lose a row — but stepping (rather than jumping to `scrollHeight`) is what
// keeps the collection correct if Gemini ever windows the sidebar.
const NAV_SCROLL_STEP_FRACTION = 0.9;
// Milliseconds to dwell after each scroll round. A sidebar page is a server fetch, not a
// re-layout, so this matches the exchange walk's data-load delay rather than a render frame.
const NAV_STEP_DELAY_MS = 500;
// Consecutive quiet rounds at a clamped port before the list counts as fully loaded. Every one of
// the four pages measured on 2026-08-10 landed inside a single 1500 ms round, but four samples
// bound nothing about the tail, so this is sized against the slowest comparable page load this
// repo has measured (ChatGPT's `#history` at 2830 ms): 6 x 500 ms = 3 s.
const NAV_STABLE_ROUNDS = 6;
// Extra quiet rounds granted while `pageParityGate` still says a page is owed — 6 s more, 9 s
// total. Bounded rather than open-ended because parity is ASYMMETRIC evidence: a list whose
// length is an exact multiple of the page size ends on a full-size page and is indistinguishable
// from one page short, so an unbounded wait would burn the step cap on a complete account.
const NAV_PENDING_EXTRA_ROUNDS = 12;
// Anti-runaway ceiling only. The measured 93-conversation sidebar needs ~6 stepping rounds plus
// the dwell; this leaves room for an account orders of magnitude larger before the walk gives up
// (and giving up returns the accumulation, it does not discard it).
const NAV_ABSOLUTE_MAX_STEPS = 400;
// Polling knobs for `openConversation`'s wait-for-render loop. The timeout is the per-conversation
// budget a bulk run spends before recording a miss and moving on.
const OPEN_POLL_MS = 150;
const OPEN_TIMEOUT_MS = 15000;
// Consecutive polls on an IDENTICAL signature that count as "the incoming conversation rendered".
// Needed because the signature carries no per-conversation identity (see `messageSignature`), so
// two similarly shaped chats produce the same string and the change can never be observed.
const OPEN_SETTLE_ROUNDS = 2;


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
 * Gemini adapter — single-conversation export plus the history-sidebar bulk track. Each member
 * is present only because its DOM was verified live, and an unverified implementation is worse
 * than an absent one (AGENTS.md #5):
 *
 *  - The sidebar track (`listConversations` / `openConversation` / `loadMoreConversations`) rests
 *    on the 2026-08-10 measurement — the sidebar pages at 20, append-only with no recycling, and
 *    identity is 1:1 (93 rows ↔ 93 anchors ↔ 93 distinct `/app/<16-hex>` ids, none outside a row).
 *  - The **Notebooks / project track stays unimplemented**, and its justification is unchanged:
 *    Gemini's project analogue is Notebooks (Gems were measured and are not a project home), and
 *    the measuring account had zero notebooks, so its list markup has never been seen.
 *
 * Absence alone is not enough to hide a feature, though — the content layer has to *read* it.
 * `syncConversationButtons` gates the bulk icon on `listConversations` + `openConversation` being
 * present, and `pickProjectAdapter` gates the project trigger on `matchesProject`.
 */
export const geminiAdapter: ConversationAdapter = {
  provider: PROVIDER,
  matches,
  extract,
  toolbarMount,
  toolbarButtonClass: TOOLBAR_BUTTON_CLASS,
  toolbarAnchor,
  listConversations,
  openConversation,
  loadMoreConversations,
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

/**
 * The history sidebar's scroll viewport, resolved by CONTAINMENT rather than by an id — the
 * sidebar's `infinite-scroller` carries no `data-test-id` at all, while the message list's
 * carries `chat-history-container` (verified live 2026-08-10). So: drop the message list, then
 * prefer a scroller that actually holds conversation rows.
 *
 * The last remaining candidate is returned when none holds a row, because an expanded sidebar
 * with no conversations is a legitimately empty account — the caller enumerates nothing from it.
 * `null` only when the document holds no non-message scroller at all, which is a markup change.
 */
function resolveSidebarScroller(root: ParentNode = document): Element | null {
  const candidates = Array.from(root.querySelectorAll(selectors.sidebarScroller)).filter(
    (scroller) => !scroller.matches(selectors.scrollContainer),
  );
  return candidates.find((scroller) => scroller.querySelector(selectors.sidebarConversationRow)) ?? candidates.at(-1) ?? null;
}

/**
 * `resolveSidebarScroller`, but a missing sidebar fails loud instead of resolving to an empty
 * list. A total absence is a markup change, not an empty account, and the bulk panel renders the
 * same "nothing to export" state for both — so only the adapter can tell them apart
 * (AGENTS.md #4). `findSidebarAnchor` keeps the nullable form: `openConversation` owns its own
 * per-conversation wording for that case.
 */
function requireSidebarScroller(root: ParentNode = document): Element {
  const scroller = resolveSidebarScroller(root);
  if (!scroller) {
    throw new ExtractionError(
      'Could not find Gemini’s conversation sidebar. Gemini’s markup may have changed — please report this.',
    );
  }
  return scroller;
}

/**
 * The COLLAPSED sidebar, which is the one shape that would otherwise export as an empty account.
 * Measured 2026-08-10: collapsed, a `/app` page still renders 31 conversation rows while the
 * document holds **0** `a[href^="/app/"]`, so `rows > 0 && anchors === 0` is positive evidence of
 * a collapsed sidebar rather than a guess. Left unchecked it returns `[]`, which the bulk panel
 * shows as "no conversations" — indistinguishable from a real empty account (AGENTS.md #4).
 *
 * The fix is asked of the USER rather than performed: Gemini's sidebar toggle button was never
 * measured, and inventing a selector for it is exactly what AGENTS.md #5 forbids.
 */
function assertSidebarExpanded(scroller: Element): void {
  const rows = scroller.querySelectorAll(selectors.sidebarConversationRow).length;
  if (rows === 0) return;
  if (scroller.querySelector(selectors.sidebarConversationLink)) return;
  throw new ExtractionError(
    'Gemini’s conversation sidebar is collapsed, so its conversation links cannot be read. ' +
      'Open the sidebar (the menu button at the top left) and try again.',
  );
}

/**
 * Enumerate the history sidebar into the lightweight listing model, in DOM order. Pure DOM
 * read — no messages are scraped here. Anchors are read from the resolved scroller, which the
 * 2026-08-10 measurement showed holds every `/app/` anchor in the document (0 outside a row).
 */
function listConversations(root: ParentNode = document): SidebarConversation[] {
  const scroller = requireSidebarScroller(root);
  assertSidebarExpanded(scroller);
  return collectSidebarConversations(scroller.querySelectorAll(selectors.sidebarConversationLink), documentOrigin(root));
}

/**
 * Fold sidebar anchors into an insertion-ordered id map, deduped by conversation id.
 *
 * One anchor that cannot be read — a deeper `/app/<id>/something` route, an id that is not the
 * measured 16-hex shape — is SKIPPED rather than failing the whole list: ordinary UI churn must
 * not cost the user every other conversation. What is kept is the half that matters: a sidebar
 * that rendered anchors and resolved NONE of them fails loud, so the panel can never show an
 * empty list where conversations exist (AGENTS.md #4). Zero anchors is not that case — the
 * caller has already proved the scroller is there and the sidebar is expanded.
 */
function collectSidebarConversations(anchors: Iterable<Element>, origin: string): SidebarConversation[] {
  const acc = new Map<string, SidebarConversation>();
  let seen = 0;
  for (const anchor of anchors) {
    seen++;
    const href = anchor.getAttribute('href');
    const resolved = href ? resolveConversationHref(href, origin) : null;
    if (!resolved) continue;
    if (!acc.has(resolved.id)) acc.set(resolved.id, { id: resolved.id, title: sidebarTitle(anchor), url: resolved.url });
  }
  if (seen > 0 && acc.size === 0) {
    throw new ExtractionError(
      'Could not read any Gemini sidebar conversation link: their URLs are not the expected ' +
        '/app/<id> shape. Gemini’s markup may have changed — please report this.',
    );
  }
  return [...acc.values()];
}

/**
 * The row's human label. Gemini localizes it, so it is only ever read as a title and never
 * matched on. An untitled anchor keeps its conversation with a generic label rather than being
 * dropped: the title is the checklist caption, not the identity — the id is.
 */
function sidebarTitle(anchor: Element): string {
  const label = (anchor.getAttribute('aria-label') ?? anchor.textContent ?? '').trim();
  return label || 'Gemini conversation';
}

/**
 * Split a sidebar href into its stable conversation id and canonical absolute URL. The id shape
 * is pinned to the measured 16-hex (2026-08-10: 93/93 anchors matched), which also rejects the
 * `/app` new-chat route and any deeper route this adapter was never verified against — those are
 * skipped by the caller rather than exported as conversations.
 */
function resolveConversationHref(href: string, origin: string): { id: string; url: string } | null {
  try {
    const parsed = new URL(href, origin);
    const match = parsed.pathname.match(/^\/app\/([0-9a-f]{16})\/?$/);
    if (!match) return null;
    return { id: match[1], url: `${origin}/app/${match[1]}` };
  } catch {
    return null;
  }
}

/** The document's own origin, falling back to the measured host (happy-dom reports `'null'`). */
function documentOrigin(root: ParentNode): string {
  const origin = ownerDocument(root)?.defaultView?.location?.origin;
  return origin && origin !== 'null' ? origin : 'https://gemini.google.com';
}

/**
 * Load every not-yet-rendered sidebar conversation by stepping the measured scroll port, folding
 * each round's anchors into an id map and resolving with the whole accumulation.
 *
 * Settles only on a port that is both STATIC and CLAMPED: a round that added nothing while the
 * port still scrolled further is a page in flight, not the end of the list. On step-cap
 * exhaustion the accumulation is returned alongside `onIncomplete` rather than thrown away —
 * `onIncomplete` is the shared partial-list signal (src/adapters/types.ts) and the panel reads it
 * only after the promise resolves, so throwing would replace a partial list with a bare error.
 */
async function loadMoreConversations(
  root: ParentNode = document,
  options: LoadMoreOptions = {},
): Promise<SidebarConversation[]> {
  const scroller = requireSidebarScroller(root);
  assertSidebarExpanded(scroller);

  // Start from a row, not the scroller element: the scroller is the list's own shell and the
  // element that actually overflows may be an ancestor of it (Claude's aside behaves the same
  // way). Fall back to the scroller's scrolling ancestor when no row has rendered yet.
  const firstRow = scroller.querySelectorAll(selectors.sidebarConversationRow)[0] ?? null;
  const rowPort = firstRow ? findScrollableAncestor(firstRow) : null;
  const container =
    rowPort && hasScrollMetrics(rowPort) && rowPort.scrollHeight > rowPort.clientHeight
      ? rowPort
      : findScrollableAncestor(scroller);
  if (container.scrollHeight <= container.clientHeight) return listConversations(root);

  const origin = documentOrigin(root);
  const acc = new Map<string, SidebarConversation>();
  const stepDelayMs = options.stepDelayMs ?? NAV_STEP_DELAY_MS;
  const stableRounds = options.stableRounds ?? NAV_STABLE_ROUNDS;
  const maxSteps = options.maxSteps ?? NAV_ABSOLUTE_MAX_STEPS;
  const morePagesOwed = pageParityGate(() => acc.size, {
    knownPageSize: options.knownPageSize,
    onPageSize: options.onPageSize,
  });
  let previousTop = -1;
  // Zero, not -1: an empty-but-scrollable sidebar would otherwise satisfy `acc.size > lastCount`
  // on the first round and report progress of 0 conversations to the panel.
  let lastCount = 0;
  let stable = 0;

  for (let step = 0; step < maxSteps; step++) {
    for (const conversation of collectSidebarConversations(
      scroller.querySelectorAll(selectors.sidebarConversationLink),
      origin,
    )) {
      if (!acc.has(conversation.id)) acc.set(conversation.id, conversation);
    }
    // Stateful (it diffs against the count it saw last round), so it is consulted every round
    // rather than only on the rounds where its answer is used.
    const owed = morePagesOwed();
    if (acc.size > lastCount) {
      options.onProgress?.(acc.size);
      stable = 0;
    } else if (container.scrollTop <= previousTop) {
      stable++;
      if (stable >= stableRounds + (owed ? NAV_PENDING_EXTRA_ROUNDS : 0)) {
        if (owed) options.onIncomplete?.();
        return [...acc.values()];
      }
    } else {
      stable = 0;
    }
    previousTop = container.scrollTop;
    lastCount = acc.size;
    const advance = Math.max(1, Math.floor(container.clientHeight * NAV_SCROLL_STEP_FRACTION));
    container.scrollTop = Math.min(container.scrollTop + advance, container.scrollHeight);
    await delay(stepDelayMs);
  }

  options.onIncomplete?.();
  return [...acc.values()];
}

/**
 * A stateful "is another page still owed?" test, built on the one regularity the 2026-08-10
 * measurement found: the sidebar appends a FIXED number of conversations per page — 20, three
 * times over, then a terminal page of 2 (31 + 20 x 3 + 2 = 93), each page also adding exactly
 * 20 x 32 px of scroll height. So a full-size last batch means the list was cut on a page
 * boundary and another page may follow, while a short one can only be the end.
 *
 * Counted off the accumulated conversation ids rather than raw rows, which the ChatGPT twin
 * cannot do: there, a page's rows split between `/c/` and project-scoped conversations in a
 * ratio that varies per page. Gemini's identity is 1:1 (93 rows ↔ 93 anchors ↔ 93 distinct ids,
 * 0 anchors outside a row), so the two counts cannot diverge.
 *
 * A batch is judged only once it has SETTLED — growth is accumulated and classified on the first
 * round that adds nothing. Judging each round's delta alone would misread a page that arrives
 * across two rounds as two short batches, and "short ⇒ exhausted" would then end the walk early.
 *
 * **The initial render must not seed the page size**, which is where this departs from ChatGPT's
 * gate. There the first render measured exactly one page, so seeding from it is evidence; here it
 * is 31 against a page size of 20, so the same seed would be simply wrong — no batch could ever
 * match it and the oracle would go silent. The size is therefore derived only from a settled
 * batch, and the gate stays `false` until one has established it (so a history shorter than one
 * page, where no batch is ever seen, never claims a page is owed).
 *
 * Read the evidence for what it is: ASYMMETRIC. A short batch proves the end; a full-size one
 * does not prove more is coming. Callers must bound how long they act on it — see
 * `NAV_PENDING_EXTRA_ROUNDS`.
 */
function pageParityGate(
  count: () => number,
  { knownPageSize = 0, onPageSize }: { knownPageSize?: number; onPageSize?: (size: number) => void } = {},
): () => boolean {
  let previous = -1;
  let pageSize = knownPageSize;
  let pending = false;
  let batch = 0;
  return () => {
    const current = count();
    if (previous < 0) {
      // Deliberately no seed — see the doc comment. The first render is 31 against a 20-item
      // page, so everything the walk knows about page size has to come from a batch it watched
      // arrive. `knownPageSize` (a size an earlier walk REPORTED) is the one exception, and it is
      // already in `pageSize`.
    } else if (current > previous) {
      // Still arriving — accumulate, do not judge yet.
      batch += current - previous;
    } else if (batch > 0) {
      // Growth stopped, so the batch is whole and can finally be classified.
      const known = pageSize; // the size in force BEFORE this batch can redefine it, below
      const established = known > 0;
      if (batch > pageSize) pageSize = batch;
      pending = established && batch === pageSize;
      // Report only a size this batch MATCHED, never one it defined. A batch that grew the size
      // is the gate's own guess — two pages coalescing into one settled batch reads as double —
      // and the caller caches what lands here for the page's whole lifetime, where
      // `knownPageSize` outranks everything and a cached guess could never self-heal.
      if (established && batch === known) onPageSize?.(known);
      batch = 0;
    }
    previous = current;
    return pending;
  };
}

/** Nearest vertically-scrollable ancestor of a sidebar node — the element that actually scrolls. */
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

/**
 * Open a selected sidebar conversation in place and wait for the target route to render its own
 * exchanges. The verified anchor is CLICKED rather than `location` being assigned: Gemini is an
 * SPA, and a reload would tear down the content script and the in-flight bulk run with it.
 */
async function openConversation(url: string, opts: OpenConversationOptions = {}): Promise<void> {
  const { pollMs = OPEN_POLL_MS, timeoutMs = OPEN_TIMEOUT_MS } = opts;
  const target = resolveConversationHref(url, location.origin);
  if (!target) {
    throw new ExtractionError('Could not open a selected Gemini conversation: its URL is malformed. It was skipped.');
  }

  if (location.pathname === `/app/${target.id}` && hasRenderedMessages()) return;

  // Reveal before reporting a miss. `findSidebarAnchor` only ever sees anchors already rendered,
  // and the sidebar pages at 20 (2026-08-10) — so on any account past the first page the target
  // is simply not in the DOM yet. Stepping the measured port is the same walk the panel's own
  // "Load more" performs. One pass, not a loop: the walk already runs to the end of the port.
  const anchor = findSidebarAnchor(target.id) ?? (await revealSidebarAnchor(target.id, pollMs, timeoutMs));
  if (!anchor) {
    throw new ExtractionError(
      'Could not open a selected Gemini conversation: its sidebar link was not found, ' +
        'even after scrolling the conversation list. It was skipped.',
    );
  }

  const beforeSignature = messageSignature();
  // The NODES, not a description of them — see `exchangeNodesReplaced`.
  const beforeExchanges = new Set(renderedExchanges());
  anchor.click();
  if (await waitForOpenedConversation(target.id, beforeSignature, beforeExchanges, pollMs, timeoutMs)) return;
  throw new ExtractionError(
    'Timed out opening a selected Gemini conversation. It may be loading slowly; it was skipped.',
  );
}

/**
 * Wait for the clicked route to render its own exchanges.
 *
 * A changed `messageSignature()` is the primary proof that the outgoing conversation was
 * replaced, and it is the fast path: it resolves the moment the swap is observed.
 *
 * The signature carries no per-conversation identity, though, so two similarly shaped chats
 * produce the same string and the change can never be observed — for that collision the wait also
 * accepts a signature that stayed IDENTICAL across `OPEN_SETTLE_ROUNDS` polls, but ONLY once
 * `exchangeNodesReplaced` shows a render actually happened. That second condition is not
 * optional: "unchanged signature" is equally consistent with "swapped to a chat that renders
 * identically" and "has not swapped yet", and Gemini's router flips the route before Angular
 * swaps the exchange DOM — so on the settle rounds alone this branch fires while the OUTGOING
 * conversation is still on screen, and the bulk driver then extracts and saves the previous chat
 * under this one's name (AGENTS.md #4).
 *
 * Node identity is what separates the two states; elapsed time is not. A minimum dwell was tried
 * first and rejected on evidence: it only moves the acceptance point (~450 ms → ~1520 ms) while
 * accepting the same thing, because time carries no information about whether a render occurred,
 * only an unmeasured prior about how long one takes.
 */
async function waitForOpenedConversation(
  id: string,
  beforeSignature: string,
  beforeExchanges: ReadonlySet<Element>,
  pollMs: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let previous: string | null = null;
  let stable = 0;
  while (Date.now() < deadline) {
    await delay(pollMs);
    if (location.pathname !== `/app/${id}` || !hasRenderedMessages()) {
      previous = null;
      stable = 0;
      continue;
    }
    const signature = messageSignature();
    if (signature !== beforeSignature) return true;
    stable = signature === previous ? stable + 1 : 0;
    previous = signature;
    if (stable >= OPEN_SETTLE_ROUNDS && exchangeNodesReplaced(beforeExchanges)) return true;
  }
  return false;
}

/**
 * True once every rendered exchange is a DIFFERENT object from the ones captured before the
 * click — i.e. the page tore down the outgoing conversation's nodes and built new ones. This is a
 * browser guarantee about node replacement, not a claim about Gemini's markup, so unlike a
 * comparison of the exchanges' id VALUES it rests on nothing unmeasured (whether those ids are
 * stable per conversation or regenerated per render has never been measured — AGENTS.md #5).
 *
 * Deliberately `every`, not `some`: a mixed list still holds nodes from the outgoing chat, so
 * accepting it would be accepting a half-swapped page.
 *
 * **The residual is a false NEGATIVE, and it is not the harmless case.** If Angular ever reuses
 * the exchange nodes in place — rewriting their contents rather than replacing them — a
 * conversation that genuinely opened, and whose shape happens to match the outgoing one, is never
 * accepted here and `openConversation` times out. That conversation is then skipped from the
 * batch with a visible error. It is the deliberately chosen direction, because the alternative
 * failure is exporting the wrong conversation's content under the right conversation's name with
 * no error at all, and a visible skip is recoverable where a silently wrong file is not.
 */
function exchangeNodesReplaced(beforeExchanges: ReadonlySet<Element>): boolean {
  const current = renderedExchanges();
  return current.length > 0 && current.every((exchange) => !beforeExchanges.has(exchange));
}

/** The exchange containers currently in the document, as object references. */
function renderedExchanges(): Element[] {
  return Array.from(document.querySelectorAll(selectors.exchange));
}

/**
 * Walk the sidebar's scroll port once so a target below the fold renders, then look again.
 * Returns null when the walk surfaced nothing — the caller turns that into its own skip error. A
 * failure inside the walk is swallowed on purpose: this runs only when the anchor was already
 * missing, so "link was not found" is the accurate report either way, and letting a scroll
 * problem replace it would blame the wrong thing.
 */
async function revealSidebarAnchor(id: string, stepDelayMs: number, timeoutMs: number): Promise<HTMLElement | null> {
  try {
    // The step budget is derived from the CALLER's timeout rather than left at the loader's
    // default. That default is sized for a user-initiated "Load more" click; here the walk runs
    // BEFORE `waitForOpenedConversation` starts its clock, so an unsettled sidebar could spend
    // far longer than the caller asked for — once per conversation across a bulk export.
    await loadMoreConversations(document, {
      stepDelayMs,
      maxSteps: Math.max(1, Math.floor(timeoutMs / Math.max(1, stepDelayMs))),
    });
  } catch {
    return null;
  }
  return findSidebarAnchor(id);
}

/** The rendered sidebar anchor for a conversation id, or null when it has not rendered. */
function findSidebarAnchor(id: string): HTMLElement | null {
  const scroller = resolveSidebarScroller(document);
  if (!scroller) return null;
  for (const anchor of scroller.querySelectorAll<HTMLElement>(selectors.sidebarConversationLink)) {
    const href = anchor.getAttribute('href');
    const resolved = href ? resolveConversationHref(href, location.origin) : null;
    if (resolved?.id === id) return anchor;
  }
  return null;
}

function hasRenderedMessages(): boolean {
  return document.querySelector(selectors.exchange) !== null;
}

/**
 * A compact internal fingerprint used only to distinguish outgoing from incoming SPA content.
 * Gemini exposes no `data-index`/`aria-setsize` analogue, so this is built from the exchange
 * containers' opaque ids plus the exchange count and two text LENGTHS — enough to notice a
 * replaced conversation, and deliberately not treated as an identity (see
 * `waitForOpenedConversation`).
 */
function messageSignature(): string {
  const exchanges = renderedExchanges();
  const ids = exchanges.map((exchange) => exchange.getAttribute('id') ?? '').join(',');
  const first = exchanges[0]?.textContent?.trim() ?? '';
  const last = exchanges.at(-1)?.textContent?.trim() ?? '';
  return `${ids}:${exchanges.length}:${first.length}:${last.length}`;
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
 * **The split above is measurably wrong for one shape (2026-07-29).** A generated-image response
 * renders its prose container PRESENT but EMPTY and stays that way, so it used to take the second
 * branch and receive retry advice — a dead end, the exact outcome this split exists to prevent.
 * Present-but-empty is therefore not always a half-rendered page. The generated-image branch now
 * emits an honest `[Image]` marker; other empty prose still receives retry advice.
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
 *
 * Measured 2026-07-29: **neither candidate reaches here.** A generated image and a
 * Canvas/immersive response BOTH render a `.markdown`. Canvas fills it (221 chars — it exports
 * fine, only the panel's own document is left behind), and a generated image leaves it EMPTY,
 * which falls to `unreadableExchangeError` instead — so the never-clearing retry advice this
 * function exists to avoid is exactly what that shape currently produces. Fixing that is a
 * behaviour change, tracked in backlog.md. See docs/live-dom-verification.md → Gemini →
 * 2026-07-29. Which shapes, if any, DO render no container at all remains unmeasured.
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
  const attachments = readAttachmentMarkers(query);
  if (attachments === null) throw unreadableExchangeError();

  const lines = Array.from(scope.querySelectorAll(selectors.userQueryLine));
  if (lines.length > 0) {
    const text = lines
      .map((line) => (line.textContent ?? '').trim())
      .join('\n')
      .trim();
    if (text) return joinUserContent(attachments, text);
  }

  const fallback = textWithoutScreenReaderLabel(scope);
  if (fallback) return joinUserContent(attachments, fallback);

  if (attachments) return attachments;

  // A prompt holding only a pasted image has no readable text node. Describe it rather than
  // yielding empty — an empty turn fails the WHOLE export, so one image-only message would
  // block the conversation entirely. `img` is a standard tag, not a guessed Gemini selector.
  //
  // Measured 2026-07-29, which settles where the tiles live: inside `user-query` but OUTSIDE
  // `.query-text`, as `user-query-file-carousel > user-query-file-preview` (one per file). The
  // earlier `user-query img` count of 0 was an artifact of no measured conversation having had
  // an attachment, not evidence of absence — with one attached it reads 1.
  //
  // The asymmetry that still constrains what a marker may say: an IMAGE preview
  // (`[data-test-id="uploaded-img"]`) exposes NO file name anywhere, and its `alt` is a
  // localized generic string ("업로드된 이미지 미리보기"), so unlike Claude it must not be read
  // as a name — a generic `[Image]` is the most that can be said. A non-image file
  // (`[data-test-id="uploaded-file"]`) does carry one, but only as `filename-label` (basename)
  // plus an uppercase `extension-label`, so a `[File: …]` marker means joining the two rather
  // than reading an attribute. See docs/live-dom-verification.md → Gemini → 2026-07-29.
  //
  // `[unknown]` — that same measurement makes this line's REACHABILITY unverified. `scope` narrows
  // to `.query-text` whenever it exists, and the tiles were measured to sit outside it (and
  // `.query-text` held no `<img>`), so this can only fire through the `?? query` fallback — i.e.
  // when a prompt renders no `.query-text` at all. Whether an image-ONLY prompt does that was not
  // exercised (the measured prompt carried text plus files). If it renders an empty `.query-text`
  // instead, this returns '' and `readExchange` throws, blocking the export — so treat the
  // user-half `[Image]` as unproven for that case rather than as working cover (AGENTS.md #5).
  if (scope.querySelector('img')) return '[Image]';
  return '';
}

/**
 * Attachment previews sit outside `.query-text`, so read them from the user-query root.
 * Images have no stable filename; files expose a basename and an uppercase extension in
 * separate labels. Unknown or incomplete previews stay unclaimed and fail loud rather than
 * producing a fabricated marker (AGENTS.md #5).
 */
function readAttachmentMarkers(query: Element): string | null {
  const previews = Array.from(
    query.querySelectorAll(`${selectors.userFileCarousel} > ${selectors.userFilePreview}`),
  );
  if (previews.length === 0) return '';

  const markers = previews.map((preview) => {
      const image = preview.matches(selectors.uploadedImage)
        ? preview
        : preview.querySelector(selectors.uploadedImage);
      if (image) return '[Image]';

      const file = preview.matches(selectors.uploadedFile)
        ? preview
        : preview.querySelector(selectors.uploadedFile);
      if (!file) return '';
      const name = file.querySelector(selectors.filenameLabel)?.textContent?.trim();
      const extension = file.querySelector(selectors.extensionLabel)?.textContent?.trim().toLowerCase();
      return name && extension ? `[File: ${name}.${extension}]` : '';
  });
  return markers.every(Boolean) ? markers.join('\n\n') : null;
}

function joinUserContent(attachments: string, text: string): string {
  return attachments ? `${attachments}\n\n${text}` : text;
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
 * from an empty one and gets a different error: see `readExchange`. A measured generated-image
 * response is the one exception to empty-prose failure: its image is represented as `[Image]`.
 */
function readAssistantContent(response: Element): string | null {
  const markdown = response.querySelector(selectors.assistantMarkdown);
  if (!markdown) return null;
  // Serialize a CLONE: the normalization below mutates the tree, and the live page is the
  // user's, not ours to rewrite.
  const clone = markdown.cloneNode(true) as Element;
  normalizeCodeBlocks(clone);
  const content = htmlToMarkdown(clone);
  const hasGeneratedImage = Boolean(response.querySelector(selectors.generatedImage));
  if (content && hasGeneratedImage) return `${content}\n\n[Image]`;
  return content || (hasGeneratedImage ? '[Image]' : '');
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
