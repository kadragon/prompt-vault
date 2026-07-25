import { describe, it, expect } from 'vitest';
import { collectVirtualizedTurns } from '../../../src/adapters/claude';
import { ExtractionError } from '../../../src/core/errors';

// Model Claude's *recycling* virtualization, the shape live measurement found on
// 2026-07-25 (docs/live-dom-verification.md → Claude): the container reports its full
// height up front, but only the turn nodes whose fixed-height band intersects the current
// viewport exist in the DOM — earlier AND later turns are removed, not merely emptied.
// This is the worst case for the walk: a single jump to either end renders only that
// window, so the walk must STEP through every window to see every turn.
//
// Each turn sits in its own `[data-index]` row, and its `data-index` is its conversation
// position (live: contiguous, 0-based, and stable across a full up-then-down walk — zero
// index→role conflicts).
//
// One turn node per row is the COMMON case, not a guarantee: a 56-row conversation measured
// live 2026-07-25 held 54 such rows, one row with four turn nodes, and one with none (an
// attachment-only user turn). The `extraNodes` and `attachments` flags below model those two
// shapes, so the default 1:1 turn here is a convenience, not an assumption under test.
interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Renders hollow until fully inside the viewport — content arrives on a later sighting. */
  skeleton?: boolean;
  /**
   * Renders a TRUNCATED prefix for the first few record() rounds, then the whole thing —
   * the shape of a response still streaming when the export started. Deliberately keyed to
   * elapsed rounds, NOT to scroll position: a real response grows with wall time whether or
   * not the walk is looking at it, and a position-keyed fake can miss the bug entirely
   * (a turn whose first sighting already lands fully inside the viewport is never seen
   * mid-stream).
   */
  partial?: boolean;
  /** Empty at every scroll position: genuinely unreadable, must fail loud. */
  neverFills?: boolean;
  /** Row renders without a `data-index`, so the turn has no stable key. */
  unindexed?: boolean;
  /** A user turn holding only a pasted image: no text node, but an `<img>`. */
  imageOnly?: boolean;
  /** Extra turn nodes rendered inside the SAME indexed row as this turn. */
  extraNodes?: string[];
  /** Row renders with this index instead of its position — used to punch a hole. */
  indexOverride?: number;
  /**
   * A user turn holding ONLY file attachments. Live (2026-07-25, row 50 of 56): such a row
   * renders NO `user-message` node — the tiles sit beside the action bar — so the turn query
   * matches nothing and the row must be read off its thumbnails instead. Values are the
   * `alt` texts; an empty string models a tile that rendered without one.
   */
  attachments?: string[];
  /**
   * Suppress the user-exclusive edit control on an `attachments` row, so it cannot be
   * attributed to the user. Such a row must stay unclaimed and fail loud, not be guessed at.
   */
  noEditBar?: boolean;
}

const TURN_H = 100;
// How many record() rounds a `partial` turn stays mid-stream. Kept low enough that the
// walk is guaranteed to see the turn again after it finishes.
const STREAMING_ROUNDS = 2;

function makeWindowedDoc({
  turns,
  clientHeight = 250,
  stuckScroll = false,
  startAtBottom = true,
}: {
  turns: Turn[];
  clientHeight?: number;
  stuckScroll?: boolean;
  startAtBottom?: boolean;
}): Document {
  const scrollHeight = turns.length * TURN_H;
  let top = startAtBottom ? Math.max(0, scrollHeight - clientHeight) : 0;
  // One `record()` call = one `querySelectorAll` for the turn selector = one round.
  let rounds = 0;
  const container = {
    clientHeight,
    scrollHeight,
    get scrollTop(): number {
      return top;
    },
    set scrollTop(v: number) {
      // A stuck container ignores scroll writes (never advances toward either end).
      if (!stuckScroll) top = Math.max(0, Math.min(v, scrollHeight));
    },
  };

  const intersects = (i: number): boolean => {
    const t = i * TURN_H;
    return t < container.scrollTop + container.clientHeight && t + TURN_H > container.scrollTop;
  };
  const fullyInside = (i: number): boolean => {
    const t = i * TURN_H;
    return t >= container.scrollTop && t + TURN_H <= container.scrollTop + container.clientHeight;
  };

  // The virtualizer row wrapping turn `i`. Rows are what carry `data-index`; the adapter
  // reads them both directly (to learn which positions rendered at all) and via
  // `turnNode.closest('[data-index]')`.
  const makeRow = (t: Turn, i: number) => ({
    getAttribute: (name: string): string | null =>
      name === 'data-index' && !t.unindexed ? String(t.indexOverride ?? i) : null,
    // Only an attachment row carries tiles and the user-exclusive edit control; every other
    // row answers both queries empty, exactly as a prose row does live.
    querySelector: (sel: string): unknown =>
      sel === '[data-testid="action-bar-edit"]' && t.attachments && !t.noEditBar ? {} : null,
    querySelectorAll: (sel: string): unknown[] =>
      sel === 'button > img[alt]' && t.attachments
        ? t.attachments.map((alt) => ({
            getAttribute: (name: string): string | null => (name === 'alt' ? alt : null),
          }))
        : [],
  });

  const makeNode = (t: Turn, i: number, override?: string) => {
    const hydrated = (): boolean => (t.skeleton ? fullyInside(i) : true);
    const text = (): string => {
      if (override !== undefined) return override;
      if (t.neverFills || t.imageOnly) return '';
      // Still streaming for the first `STREAMING_ROUNDS` rounds, regardless of scroll.
      if (t.partial && rounds <= STREAMING_ROUNDS) return t.content.slice(0, 4);
      return hydrated() ? t.content : '';
    };
    const row = makeRow(t, i);
    // The turn node itself: a user bubble matches `[data-testid="user-message"]`; an
    // assistant node is the `.standard-markdown` container and matches neither.
    return {
      matches: (sel: string): boolean => sel === '[data-testid="user-message"]' && t.role === 'user',
      closest: (sel: string) => (sel === '[data-index]' && !t.unindexed ? row : null),
      // `readUserContent` walks `children`; giving it none makes it fall back to textContent.
      children: [] as Element[],
      // Consulted only when a user turn has no readable text: an image-only turn must be
      // described rather than left empty (an empty turn fails the whole export).
      querySelector: (sel: string) => (sel === 'img' && t.imageOnly ? ({} as Element) : null),
      get textContent(): string {
        return text();
      },
      // `htmlToMarkdown` (assistant path) walks childNodes; a single text node is enough.
      get childNodes(): unknown[] {
        return [{ nodeType: 3, textContent: text() }];
      },
    };
  };

  // Every turn node currently rendered, including any `extraNodes` sharing a turn's row.
  // An `attachments` turn contributes NO turn node — that is the whole point of the shape.
  const visibleNodes = (): unknown[] =>
    turns.flatMap((t, i) =>
      intersects(i) && !t.attachments
        ? [makeNode(t, i), ...(t.extraNodes ?? []).map((c) => makeNode(t, i, c))]
        : [],
    );

  return {
    querySelector: (sel: string) => (sel === '[data-autoscroll-container]' ? container : null),
    querySelectorAll: (sel: string) => {
      // Rows carry data-index; the adapter reads them to learn which positions rendered.
      if (sel === '[data-index]') {
        return turns.flatMap((t, i) => (intersects(i) && !t.unindexed ? [makeRow(t, i)] : []));
      }
      if (sel !== '[data-testid="user-message"], .standard-markdown') return [];
      rounds++;
      return visibleNodes();
    },
  } as unknown as Document;
}

const fast = { stepDelayMs: 0 };

const alternating = (n: number): Turn[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `content ${i}`,
  }));

describe('collectVirtualizedTurns — recycling message list', () => {
  it('accumulates every turn across the walk though only a few exist in the DOM at once', async () => {
    const turns = alternating(20);
    const doc = makeWindowedDoc({ turns });

    // Sanity: the fake really does window — a one-shot read sees a fraction of the list.
    const rendered = doc.querySelectorAll('[data-testid="user-message"], .standard-markdown').length;
    expect(rendered).toBeLessThan(turns.length);

    const messages = await collectVirtualizedTurns(doc, fast);
    expect(messages).toHaveLength(20);
    expect(messages.map((m) => m.content)).toEqual(turns.map((t) => t.content));
  });

  it('returns turns in conversation order even though the walk starts at the bottom', async () => {
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns: alternating(20) }), fast);
    // Live-verified: roles strictly alternate, starting with the user (roleSeq "uauaua…").
    expect(messages.slice(0, 6).map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(messages[0].content).toBe('content 0');
    expect(messages[19].content).toBe('content 19');
  });

  it('upgrades a turn first captured before its content rendered', async () => {
    const turns = alternating(12);
    turns[5] = { ...turns[5], skeleton: true };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages).toHaveLength(12);
    expect(messages[5].content).toBe('content 5');
  });

  // Upgrading only from *empty* would pin the fragment captured while the response was
  // still streaming: the walk goes on to see the finished turn and would still export the
  // truncated text — a silent content truncation, which is worse than a visible failure.
  it('replaces a partially-rendered turn once a fuller sighting appears', async () => {
    // The last turn is the one that can still be streaming when an export starts, and the
    // walk begins at the bottom — so it is observed mid-stream on the very first round.
    const turns = alternating(12);
    turns[11] = { ...turns[11], partial: true };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages).toHaveLength(12);
    expect(messages[11].content).toBe('content 11');
  });

  it('fails loud when a turn never yields content (never silently drops it)', async () => {
    const turns = alternating(12);
    turns[4] = { ...turns[4], neverFills: true };
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });

  // The whole design keys one turn per indexed row, which live data confirmed for a
  // conversation with no extended-thinking or artifact turns. If a row ever holds two turn
  // nodes, keeping only the longer would silently drop the other.
  it('joins several turn nodes rendered inside one indexed row instead of dropping one', async () => {
    const turns = alternating(12);
    turns[3] = { ...turns[3], extraNodes: ['a second block in the same row'] };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages).toHaveLength(12);
    expect(messages[3].content).toBe('content 3\n\na second block in the same row');
  });

  it('describes a user turn holding only an image rather than failing the whole export', async () => {
    // An empty turn fails the ENTIRE conversation, so one image-only message would block it.
    const turns = alternating(12);
    turns[2] = { ...turns[2], imageOnly: true };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages).toHaveLength(12);
    expect(messages[2].content).toBe('[Image]');
  });

  // A gap has two very different causes, and the wrong message sends the user in circles.
  it('blames the walk when the missing position never rendered', async () => {
    const turns = alternating(12);
    for (let i = 8; i < turns.length; i++) turns[i] = { ...turns[i], indexOverride: i + 1 };
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toThrow(
      /Scroll through the whole conversation/,
    );
  });

  it('blames unreadable markup when the missing position DID render as a row', async () => {
    // Position 8's row renders (so it is in seenRowIndices) but holds no recognizable turn.
    const turns = alternating(12);
    const unreadable: Turn = { role: 'assistant', content: '', neverFills: true };
    turns.splice(8, 0, unreadable);
    const doc = makeWindowedDoc({ turns });
    // Neutralize only the turn-node side for that row, leaving its row visible.
    const original = doc.querySelectorAll.bind(doc);
    (doc as unknown as { querySelectorAll: (sel: string) => unknown[] }).querySelectorAll = (
      sel: string,
    ) => {
      const out = original(sel) as unknown as {
        closest?: (s: string) => { getAttribute(n: string): string | null } | null;
      }[];
      if (sel === '[data-index]') return out;
      return out.filter((n) => n.closest?.('[data-index]')?.getAttribute('data-index') !== '8');
    };
    await expect(collectVirtualizedTurns(doc, fast)).rejects.toThrow(/could not read/);
  });

  it('fails loud when a turn has no stable index to dedupe on', async () => {
    const turns = alternating(12);
    turns[7] = { ...turns[7], unindexed: true };
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });

  // The completeness oracle: a hole in the index range proves turns were missed. This is
  // the guarantee the ChatGPT adapter cannot make (see the residual in its review backlog).
  it('fails loud on a gap in the index range rather than returning a partial conversation', async () => {
    const turns = alternating(12);
    // Push the tail's indices up by one, leaving position 8 unclaimed by any turn.
    for (let i = 8; i < turns.length; i++) turns[i] = { ...turns[i], indexOverride: i + 1 };
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });

  it('names the positions the gap falls between, so the error is actionable', async () => {
    const turns = alternating(12);
    for (let i = 8; i < turns.length; i++) turns[i] = { ...turns[i], indexOverride: i + 1 };
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toThrow(
      /between positions 7 and 9/,
    );
  });

  // Contiguity alone cannot see a range that is complete but starts late: turns 1..n are as
  // contiguous as 0..n. Claude numbers rows from zero (live 2026-07-25: `minIndex` 0 on a
  // 56-row conversation), so position 0 missing is a hole, not an offset.
  it('fails loud when the collected range never reaches position 0', async () => {
    const turns = alternating(12);
    // Every row reports one position higher than it holds, so 0 is unclaimed while the rest
    // stays contiguous — the exact shape a contiguity-only check waves through.
    for (let i = 0; i < turns.length; i++) turns[i] = { ...turns[i], indexOverride: i + 1 };
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toThrow(
      /first turn never loaded/,
    );
  });

  // A leading hole splits the same two ways an interior one does, and pointing the user at
  // the top of a conversation they already scrolled through would send them in circles.
  it('blames unreadable markup when position 0 DID render as a row', async () => {
    const turns = alternating(12);
    turns.unshift({ role: 'user', content: '', neverFills: true });
    const doc = makeWindowedDoc({ turns });
    // Leave row 0 visible (so it lands in seenRowIndices) but hide its turn node, the shape
    // of a row holding something the adapter does not recognize at all.
    const original = doc.querySelectorAll.bind(doc);
    (doc as unknown as { querySelectorAll: (sel: string) => unknown[] }).querySelectorAll = (
      sel: string,
    ) => {
      const out = original(sel) as unknown as {
        closest?: (s: string) => { getAttribute(n: string): string | null } | null;
      }[];
      if (sel === '[data-index]') return out;
      return out.filter((n) => n.closest?.('[data-index]')?.getAttribute('data-index') !== '0');
    };
    await expect(collectVirtualizedTurns(doc, fast)).rejects.toThrow(/position 0 that this/);
  });

  // The failure this shape used to cause was total: one attachment-only turn made the whole
  // conversation unexportable, because its row claimed a position no turn could fill.
  it('describes an attachment-only user turn instead of failing the whole export', async () => {
    const turns = alternating(9);
    turns[4] = { role: 'user', content: '', attachments: ['report.pdf'] };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages).toHaveLength(9);
    expect(messages[4]).toEqual({ role: 'user', content: '[File: report.pdf]' });
  });

  it('lists every attachment on a turn holding several', async () => {
    const turns = alternating(9);
    turns[4] = { role: 'user', content: '', attachments: ['a.pdf', 'b.png'] };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages[4].content).toBe('[File: a.pdf]\n\n[File: b.png]');
  });

  // The recognizer is deliberately narrow: it claims a row only on the evidence that was
  // actually measured. Anything else keeps the old loud failure rather than being guessed at.
  it('leaves a turnless row unclaimed when it cannot be attributed to the user', async () => {
    const turns = alternating(9);
    turns[4] = { role: 'user', content: '', attachments: ['report.pdf'], noEditBar: true };
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toThrow(
      /could not read/,
    );
  });

  it('leaves a turnless row unclaimed when its tiles carry no name to report', async () => {
    const turns = alternating(9);
    turns[4] = { role: 'user', content: '', attachments: [''] };
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toThrow(
      /could not read/,
    );
  });

  it('fails loud when the container never reaches an end (stuck scroll)', async () => {
    await expect(
      collectVirtualizedTurns(makeWindowedDoc({ turns: alternating(20), stuckScroll: true }), fast),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('falls back to a one-shot read when there is no scroll container', async () => {
    const doc = makeWindowedDoc({ turns: alternating(4), clientHeight: 400 });
    const noContainer = {
      querySelector: () => null,
      querySelectorAll: (sel: string) => doc.querySelectorAll(sel),
    } as unknown as Document;
    const messages = await collectVirtualizedTurns(noContainer, fast);
    expect(messages).toHaveLength(4);
  });

  it('falls back to a one-shot read when the container has zero height (background tab)', async () => {
    const doc = makeWindowedDoc({ turns: alternating(4), clientHeight: 0 });
    const messages = await collectVirtualizedTurns(doc, fast);
    // clientHeight 0 means nothing intersects, so the snapshot is empty rather than a
    // multi-minute 1px-at-a-time crawl to the step cap.
    expect(messages).toHaveLength(0);
  });
});
