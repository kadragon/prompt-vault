import type { Conversation, Message, Role } from '../../core/conversation';
import { ExtractionError } from '../../core/errors';
import { blockToMarkdown, htmlToMarkdown } from '../../core/html-to-markdown';
import type { ConversationAdapter } from '../types';
import { matches } from './matches';
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
 * Claude adapter — single-conversation export only. Every other `ConversationAdapter`
 * member is optional and deliberately unimplemented: the sidebar bulk track and the
 * project track would each need their own live-DOM verification, and an unverified
 * implementation is worse than an absent one.
 *
 * Absence alone is not enough to hide a feature, though — the content layer has to *read*
 * it. `syncConversationButtons` gates the bulk icon on `listConversations` +
 * `openConversation` being present, and `pickProjectAdapter` gates the project trigger on
 * `matchesProject`; without the former, registering this adapter rendered a bulk button on
 * every Claude chat that answered a click with "not supported".
 */
export const claudeAdapter: ConversationAdapter = {
  provider: PROVIDER,
  matches,
  extract,
  toolbarMount,
  toolbarButtonClass: TOOLBAR_BUTTON_CLASS,
  toolbarAnchor,
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
 * One-shot read of every turn currently in `root` (fixtures, or a live page with no
 * scroll container). Document order is the conversation order because a turn is either a
 * user bubble or an assistant prose container and the two are disjoint. Fails loud if a
 * turn yielded no content — a silently dropped turn is worse than a visible error
 * (AGENTS.md #4).
 */
function readSnapshot(root: ParentNode): Message[] {
  const nodes = Array.from(root.querySelectorAll(selectors.turn));
  const messages = nodes.map(toMessage).filter((m): m is Message => m !== null);
  if (messages.length > 0 && messages.length < nodes.length) {
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
    const round = new Map<number, { role: Role; parts: string[] }>();
    for (const el of Array.from(doc.querySelectorAll(selectors.turn))) {
      const index = rowIndex(el.closest(selectors.turnRow));
      if (!Number.isInteger(index)) {
        // No stable key to dedupe this turn across windows, so it can never be collected
        // reliably. Flag it and fail loud rather than silently omit it (AGENTS.md #4).
        sawUnindexedTurn = true;
        continue;
      }
      const existing = round.get(index);
      if (existing) existing.parts.push(readTurn(el));
      else round.set(index, { role: roleOf(el), parts: [readTurn(el)] });
    }

    // A user turn holding ONLY attachments renders no `user-message` node at all — the
    // tiles sit in the row beside the action bar, with nothing the turn query can match
    // (verified live 2026-07-25 on row 50 of a 56-row conversation). Left alone, that row
    // is a position no turn claims, so `buildMessages` reports it as unreadable and the
    // WHOLE conversation fails to export. Describe it instead, the way the ChatGPT adapter
    // describes its attachment tiles.
    //
    // Deliberately narrow: a row qualifies only if it carries attachment images AND the
    // user-exclusive edit control. A row failing either test is left unclaimed and still
    // fails loud (AGENTS.md #4) — this recognizes the one shape that was measured rather
    // than guessing at every row the turn query happens to miss.
    for (const row of Array.from(doc.querySelectorAll(selectors.turnRow))) {
      const index = rowIndex(row);
      if (!Number.isInteger(index) || round.has(index)) continue;
      const files = attachmentMarkers(row);
      if (files) round.set(index, { role: 'user', parts: [files] });
    }

    for (const [index, { role, parts }] of round) {
      const content = parts
        .map((part) => part.trim())
        .filter(Boolean)
        .join('\n\n');
      const seen = turns.get(index);
      if (!seen) {
        turns.set(index, { role, content });
      } else if (content.length > seen.content.trim().length) {
        // Keep the fullest sighting of this turn, not merely the first non-empty one.
        // Upgrading only from empty would permanently pin a fragment captured while the
        // response was still streaming or hydrating: the walk would then go on to see the
        // finished turn and still export the truncated text — a silent content truncation
        // (AGENTS.md #4). Length is the ordering because a fuller render is a superset of
        // a partial one; a node caught mid-teardown renders shorter and is ignored.
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
      atEnd: (c) => c.scrollTop + c.clientHeight >= c.scrollHeight - 1,
      step: (c) => {
        c.scrollTop = Math.min(c.scrollTop + stepPx, c.scrollHeight);
      },
      stepPx,
    });
    if (!reachedBottom) {
      throw new ExtractionError(
        'Timed out loading the full conversation while scrolling. The conversation may be ' +
          'unusually long; try again, or report if this persists.',
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
 * now reads one — "every position is filled" is not "every turn is finished". See
 * docs/live-dom-verification.md → "a declared total is an oracle, not a termination condition".
 */
async function walk(
  container: HTMLElement,
  stepDelayMs: number,
  maxSteps: number | undefined,
  record: () => void,
  motion: { atEnd: (c: HTMLElement) => boolean; step: (c: HTMLElement) => void; stepPx: number },
): Promise<boolean> {
  let atEndHits = 0;
  for (let step = 0; ; step++) {
    record();
    if (motion.atEnd(container)) {
      if (++atEndHits >= END_SETTLE_ROUNDS) return true;
    } else {
      atEndHits = 0;
    }
    const cap = maxSteps ?? Math.ceil(container.scrollHeight / motion.stepPx) + END_SETTLE_ROUNDS + 5;
    if (step >= cap || step >= WALK_ABSOLUTE_MAX_STEPS) return false;
    motion.step(container);
    await delay(stepDelayMs);
  }
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
  // What was measured (2026-07-25) is narrower than "attachments are handled": an
  // attachment-ONLY user turn renders no `user-message` node at all, and `attachmentMarkers`
  // claims that row a level up. A turn holding text AND a file was never captured, so where
  // its tiles sit relative to this node is unknown — such a turn still exports its text with
  // the attachment unreported. Tracked as a `[VERIFY]` in tasks.md; guessing at the mixed
  // layout would risk labelling a pasted image as a file, which is worse than the omission.
  if (el.querySelector('img')) return '[Image]';
  return '';
}

/**
 * `[File: name]` for each attachment thumbnail in a row that holds no readable turn node,
 * or an empty string when the row is not an identifiable user attachment turn. The names
 * come from each thumbnail's `alt`, so a tile that renders without one is skipped rather
 * than reported under a fabricated name — and a row whose tiles are ALL nameless yields no
 * markers, leaving it to fail loud rather than exporting a contentless turn.
 */
function attachmentMarkers(row: Element): string {
  if (!row.querySelector(selectors.userActionBar)) return '';
  return Array.from(row.querySelectorAll(selectors.attachmentImage))
    .map((img) => img.getAttribute('alt')?.trim())
    .filter((name): name is string => Boolean(name))
    .map((name) => `[File: ${name}]`)
    .join('\n\n');
}

/** Map one turn node to a normalized Message, or null if it has no content. */
function toMessage(el: Element): Message | null {
  const content = readTurn(el);
  if (!content.trim()) return null;
  return { role: roleOf(el), content };
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
