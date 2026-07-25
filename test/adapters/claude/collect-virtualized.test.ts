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

/**
 * How many rows the conversation declares in total, via the `aria-setsize` every live row
 * carries (2026-07-25: 112/112 rows across four conversations). A function of the round
 * number models a total that CHANGES mid-walk, which happens when a message lands while the
 * export is running. `null` (the default) models rows that declare nothing, so every test
 * predating the oracle keeps exercising the un-declared path.
 */
type SetSize = number | null | ((round: number) => number | null);

function makeWindowedDoc({
  turns,
  clientHeight = 250,
  stuckScroll = false,
  startAtBottom = true,
  setSize = null,
}: {
  turns: Turn[];
  clientHeight?: number;
  stuckScroll?: boolean;
  startAtBottom?: boolean;
  setSize?: SetSize;
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
  const declaredTotal = (): number | null =>
    typeof setSize === 'function' ? setSize(rounds) : setSize;

  const makeRow = (t: Turn, i: number) => ({
    getAttribute: (name: string): string | null =>
      name === 'data-index' && !t.unindexed ? String(t.indexOverride ?? i) : null,
    // Only an attachment row carries tiles and the user-exclusive edit control; every other
    // row answers both queries empty, exactly as a prose row does live. The `role="article"`
    // wrapper is the reverse: live, EVERY row has one, so it answers on any row that declares
    // a total at all.
    querySelector: (sel: string): unknown => {
      if (sel === '[role="article"][aria-setsize]') {
        const total = declaredTotal();
        return total === null
          ? null
          : {
              getAttribute: (name: string): string | null =>
                name === 'aria-setsize' ? String(total) : null,
            };
      }
      return sel === '[data-testid="action-bar-edit"]' && t.attachments && !t.noEditBar ? {} : null;
    },
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
    // One record() call = one turn-selector query, so this counts the walk's rounds. Read by
    // the early-termination test, which has no other way to see that the walk stopped sooner.
    get __rounds(): number {
      return rounds;
    },
  } as unknown as Document;
}

const roundsOf = (doc: Document): number => (doc as unknown as { __rounds: number }).__rounds;

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

  // The trailing end — the one direction the index checks are blind to. Contiguity plus the
  // starts-at-0 rule prove the collected range is exactly 0…n-1, but nothing establishes that
  // n-1 is the LAST row, so a walk that stopped short exported a plausible partial. Claude
  // declares the conversation's row count on every row (live 2026-07-25: present on 112/112
  // rows in four conversations, constant across each walk, always equal to maxIndex + 1).
  it('fails loud when fewer rows were collected than Claude declares', async () => {
    // Ten rows render; the conversation declares twelve. Both existing checks pass — 0…9 is
    // contiguous and starts at zero — which is exactly why this used to export as complete.
    const doc = makeWindowedDoc({ turns: alternating(10), setSize: 12 });
    await expect(collectVirtualizedTurns(doc, fast)).rejects.toThrow(/last 2 turns never loaded/);
  });

  // The same shape with nothing declared must behave exactly as it did before. A markup
  // change has to degrade to the old behavior, never turn every export into a failure.
  it('exports the rows it collected when no row declares a total', async () => {
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns: alternating(10) }), fast);
    expect(messages).toHaveLength(10);
  });

  // The sharp edge of ending the walk on the declared total: a position being FILLED is not
  // the same as a turn being FINISHED. A response still streaming when the export starts holds
  // its row with a fragment, and it is later rounds that grow it. Ending the moment every
  // position held something would export the fragment — the silent content truncation the
  // "keep the fullest sighting" rule already exists to prevent. Every row here renders from
  // round one, so completeness is reached while the turn is still mid-stream.
  it('does not end the walk on a turn that is still streaming, even once every row is collected', async () => {
    const turns = alternating(4);
    turns[2] = { ...turns[2], partial: true, content: 'the complete assistant answer' };
    const doc = makeWindowedDoc({ turns, clientHeight: 400, setSize: 4 });
    const messages = await collectVirtualizedTurns(doc, fast);
    expect(messages[2].content).toBe('the complete assistant answer');
  });

  // Without the declared total the walk can only infer it is finished from the scroll
  // position holding still, which costs END_SETTLE_ROUNDS at each end and a full second pass.
  // Having every declared row in hand — and no round still changing them — is proof, not
  // inference.
  it('stops the walk as soon as every declared row is collected', async () => {
    const declared = makeWindowedDoc({ turns: alternating(20), setSize: 20 });
    const undeclared = makeWindowedDoc({ turns: alternating(20) });
    expect(await collectVirtualizedTurns(declared, fast)).toHaveLength(20);
    expect(await collectVirtualizedTurns(undeclared, fast)).toHaveLength(20);
    expect(roundsOf(declared)).toBeLessThan(roundsOf(undeclared));
  });

  // The declared total tracks the live list (live 2026-07-25: 2 -> 4 across one exchange), so
  // a message landing mid-export raises it. Reading the LARGEST declaration would then fail
  // the export over turns that did not exist when it started; the smallest cannot. It costs
  // nothing in the case the check exists for, where a short walk sees the true total on every
  // row it reaches.
  it('takes the smallest declared total, so a turn arriving mid-export does not fail it', async () => {
    const doc = makeWindowedDoc({
      turns: alternating(12),
      setSize: (round) => (round < 2 ? 12 : 14),
    });
    const messages = await collectVirtualizedTurns(doc, fast);
    expect(messages).toHaveLength(12);
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
