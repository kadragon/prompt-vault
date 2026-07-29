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
   *
   * Shorthand for `tiles` in the preview-tile shape; give `tiles` directly to model the file
   * card, or to interleave the two.
   */
  attachments?: string[];
  /**
   * Attachment tiles on this row in DOCUMENT order, across BOTH shapes Claude was measured
   * rendering (2026-07-29). Combining them in one ordered list is the point: a row can hold
   * either shape, and the adapter must report them in the order they appear rather than
   * grouping by shape.
   *
   * A tile row that ALSO has `content` models a mixed turn — text plus a file, which renders
   * a `user-message` node AND tiles beside it.
   */
  tiles?: Tile[];
  /**
   * Suppress the user-exclusive edit control on an `attachments` row, so it cannot be
   * attributed to the user. Such a row must stay unclaimed and fail loud, not be guessed at.
   */
  noEditBar?: boolean;
  /**
   * An EXPANDED extended-thinking block: a second `.standard-markdown` in the same row,
   * holding this text and rendered BEFORE the answer (live 2026-07-29: `md[0]` thinking,
   * `md[1]` answer). It is distinguished by an ancestor carrying `data-timeline-text`.
   */
  thinking?: string;
  /** Render the thinking block as the row's ONLY turn node — a turn still generating. */
  thinkingOnly?: boolean;
  /**
   * Render thinking-only for the first N record() rounds, then thinking AND the answer — the
   * TRANSITION a fixed `thinkingOnly` flag cannot express. Keyed to elapsed rounds rather than
   * scroll position for the same reason `partial` is: a response finishes on wall time whether
   * or not the walk happens to be looking at that row.
   *
   * Put it on the LAST turn. Round-keying alone does not make a turn observable: the walk starts
   * at the bottom, so an early-index row is off-screen for the first rounds and is not seen until
   * well past N — by which time the fake already renders the settled shape and the test passes
   * against broken code. Same trap `partial` documents at its own test below; it caught this flag
   * too, on its first draft.
   */
  thinkingUntilRound?: number;
}

/**
 * One attachment tile. `tile` is the preview shape (name on the thumbnail's `alt`), `card`
 * the file-card shape (name in the card's `h3`, and no `<img>` in the row at all). Live
 * measurement could not establish what selects between them — a PNG produced each — so both
 * must be read (docs/live-dom-verification.md → Claude → 2026-07-29).
 */
interface Tile {
  shape: 'tile' | 'card';
  name: string;
}

/** The combined query the adapter runs against a row to find tiles of either shape. */
const ATTACHMENT_TILES = 'button > img[alt], [data-testid="file-thumbnail"] h3';

const tilesOf = (t: Turn): Tile[] =>
  t.tiles ?? (t.attachments ?? []).map((name) => ({ shape: 'tile' as const, name }));

const hasTiles = (t: Turn): boolean => tilesOf(t).length > 0;

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

  // One row OBJECT per position, shared by every node in it. Identity matters: the real
  // `closest('[data-index]')` returns the same element from every node in a row, and code that
  // groups nodes by row (the thinking-block filter) compares those references. Handing out a
  // fresh object per call would make two nodes in one row look like two rows.
  const rowCache = new Map<number, ReturnType<typeof buildRow>>();
  const makeRow = (t: Turn, i: number): ReturnType<typeof buildRow> => {
    let row = rowCache.get(i);
    if (!row) {
      row = buildRow(t, i);
      rowCache.set(i, row);
    }
    return row;
  };

  const buildRow = (t: Turn, i: number) => ({
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
      return sel === '[data-testid="action-bar-edit"]' && hasTiles(t) && !t.noEditBar ? {} : null;
    },
    // Both tile shapes come back from ONE query, in the order they were declared — so an
    // adapter that grouped by shape instead of preserving document order is visible here.
    querySelectorAll: (sel: string): unknown[] =>
      sel === ATTACHMENT_TILES
        ? tilesOf(t).map((tile) => ({
            matches: (s: string): boolean => s === 'button > img[alt]' && tile.shape === 'tile',
            getAttribute: (name: string): string | null =>
              name === 'alt' && tile.shape === 'tile' ? tile.name : null,
            // The card carries its name as the `h3`'s text, not an attribute.
            textContent: tile.shape === 'card' ? tile.name : '',
          }))
        : [],
  });

  const makeNode = (t: Turn, i: number, override?: string, thinking = false) => {
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
      closest: (sel: string) => {
        // The measured discriminator for an extended-thinking block: an ancestor carrying
        // `data-timeline-text`, which the answer container does not have.
        if (sel === '[data-timeline-text]') return thinking ? ({} as Element) : null;
        return sel === '[data-index]' && !t.unindexed ? row : null;
      },
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

  // The turn nodes row `i` currently renders, including any `extraNodes` sharing its row and
  // any expanded thinking block. An attachment turn with no text contributes NO turn node —
  // that is the whole point of the shape; one that HAS text is a mixed turn and renders both.
  const nodesIn = (t: Turn, i: number): unknown[] => {
    if (!intersects(i)) return [];
    if (hasTiles(t) && !t.content) return [];
    const nodes: unknown[] = [];
    // Thinking first: live 2026-07-29 measured `md[0]` as the thinking text and `md[1]` as
    // the answer, which is why an unfiltered join PREPENDS the reasoning to the message.
    if (t.thinking !== undefined) nodes.push(makeNode(t, i, t.thinking, true));
    const thinkingOnlyNow =
      t.thinkingOnly === true ||
      (t.thinkingUntilRound !== undefined && rounds <= t.thinkingUntilRound);
    if (!thinkingOnlyNow) {
      nodes.push(makeNode(t, i), ...(t.extraNodes ?? []).map((c) => makeNode(t, i, c)));
    }
    return nodes;
  };

  const visibleNodes = (): unknown[] => turns.flatMap((t, i) => nodesIn(t, i));

  return {
    querySelector: (sel: string) => (sel === '[data-autoscroll-container]' ? container : null),
    querySelectorAll: (sel: string) => {
      // Rows carry data-index; the adapter reads them to learn which positions rendered.
      if (sel === '[data-index]') {
        return turns.flatMap((t, i) => (intersects(i) && !t.unindexed ? [makeRow(t, i)] : []));
      }
      // The one-shot fallback asks for rows and turns together and relies on the DOM returning
      // them in document order — a row immediately before the nodes inside it. Modelled here so
      // the fallback the walk takes when there is no scroll container (or it has zero height, a
      // background tab) is exercised against the same recycling fake as the walk itself.
      if (sel === '[data-index], [data-testid="user-message"], .standard-markdown') {
        return turns.flatMap((t, i) => {
          if (!intersects(i)) return [];
          return [...(t.unindexed ? [] : [makeRow(t, i)]), ...nodesIn(t, i)];
        });
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

  // Claude renders attachments in TWO shapes and only the preview tile was ever matched, so
  // the SECOND — the file card, which puts no `<img>` in the row at all — reproduced the
  // pre-PR #35 failure in full: measured live 2026-07-29 on a 10-row conversation, rows 10,
  // claimed 9. One `.txt` made the whole conversation unexportable.
  it('describes an attachment-only turn whose file renders as a card, not a tile', async () => {
    const turns = alternating(9);
    turns[4] = { role: 'user', content: '', tiles: [{ shape: 'card', name: 'pv-probe-note.txt' }] };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages).toHaveLength(9);
    expect(messages[4]).toEqual({ role: 'user', content: '[File: pv-probe-note.txt]' });
  });

  // What selects one shape over the other was NOT established — a PNG produced each — so the
  // adapter must read both from one row and keep them in document order rather than grouping
  // by shape. The card is declared first here precisely so a `[...tiles, ...cards]` reading
  // would flip the output and fail.
  it('reports both tile shapes in one row, in document order', async () => {
    const turns = alternating(9);
    turns[4] = {
      role: 'user',
      content: '',
      tiles: [
        { shape: 'card', name: 'notes.txt' },
        { shape: 'tile', name: 'report.pdf' },
      ],
    };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages[4].content).toBe('[File: notes.txt]\n\n[File: report.pdf]');
  });

  // Skipping is per TILE, not per row: a row that renders one nameless card beside a named one
  // still reports the named file. Only a row whose tiles are ALL nameless yields nothing and
  // falls through to the loud failure below.
  it('skips only the nameless tile on a row that also carries a named one', async () => {
    const turns = alternating(9);
    turns[4] = {
      role: 'user',
      content: '',
      tiles: [
        { shape: 'card', name: '' },
        { shape: 'card', name: 'notes.txt' },
      ],
    };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages[4].content).toBe('[File: notes.txt]');
  });

  it('leaves a turnless card row unclaimed when its card carries no name', async () => {
    const turns = alternating(9);
    turns[4] = { role: 'user', content: '', tiles: [{ shape: 'card', name: '' }] };
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toThrow(
      /could not read/,
    );
  });

  it('leaves a card row unclaimed when it cannot be attributed to the user', async () => {
    const turns = alternating(9);
    turns[4] = {
      role: 'user',
      content: '',
      tiles: [{ shape: 'card', name: 'notes.txt' }],
      noEditBar: true,
    };
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toThrow(
      /could not read/,
    );
  });

  // A MIXED turn used to export its text and say nothing about the file, because the row scan
  // ran only on rows the turn query had not claimed — a silent omission rather than a failure.
  // Scanning claimed rows is safe: live 2026-07-29 measured `imgsInsideUserMessage` 0 in every
  // row, attached or pasted, so a row-level query cannot reach turn-body content.
  it('reports the attachment on a mixed turn instead of exporting the text alone', async () => {
    const turns = alternating(9);
    turns[4] = {
      role: 'user',
      content: 'have a look at this',
      tiles: [{ shape: 'card', name: 'notes.txt' }],
    };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages).toHaveLength(9);
    // Marker FIRST: live measurement put the tile ahead of the text body in document order.
    expect(messages[4]).toEqual({
      role: 'user',
      content: '[File: notes.txt]\n\nhave a look at this',
    });
  });

  // The row scan iterates row ELEMENTS, so two rows carrying the same `data-index` in one round
  // would each contribute the row's markers to the same accumulated turn. Whether Claude's
  // recycling virtualizer ever passes through that state is UNMEASURED — this pins the scan as
  // idempotent per index so the shape cannot produce a duplicated `[File: …]` if it does.
  it('reports a file once when two rows carry the same index in one round', async () => {
    // Six rows, the last overriding its index to 4: the collected range stays contiguous at
    // 0…4, so `buildMessages` passes and the assertion isolates the duplication.
    const turns = alternating(6);
    turns[4] = { role: 'user', content: '', attachments: ['notes.txt'] };
    turns[5] = { role: 'user', content: '', attachments: ['notes.txt'], indexOverride: 4 };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages).toHaveLength(5);
    expect(messages[4]).toEqual({ role: 'user', content: '[File: notes.txt]' });
  });

  // Expanding a turn's thinking chip adds a second, un-nested `.standard-markdown` to the row,
  // and every turn node in a row is joined — so the exported text silently depended on whether
  // the user happened to have the block open.
  it('excludes an expanded extended-thinking block from the assistant message', async () => {
    const turns = alternating(12);
    turns[3] = { ...turns[3], thinking: 'the user wants X, so I should…' };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages).toHaveLength(12);
    expect(messages[3].content).toBe('content 3');
  });

  // The exclusion must not convert a working export into a hard failure. A turn caught while
  // it is still generating can render its thinking block and no answer yet; dropping that node
  // unconditionally would leave the row unclaimed, and an unclaimed row fails the WHOLE export.
  it('keeps a thinking block when it is the only turn node in its row', async () => {
    const turns = alternating(12);
    turns[3] = { ...turns[3], thinking: 'still reasoning', thinkingOnly: true };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages).toHaveLength(12);
    expect(messages[3].content).toBe('still reasoning');
  });

  // …and keeping it must not make it STICK. The cross-round upgrade rule keeps the longest
  // sighting, justified by "a fuller render is a superset of a partial one" — which the thinking
  // filter breaks: a row first seen thinking-only records the whole reasoning, and the later
  // sighting that finally catches the answer is the answer ALONE, which is routinely SHORTER.
  // Length alone would then pin Claude's internal reasoning and silently discard the real
  // answer. The transition is the whole point here; the fixed-flag test above cannot see it.
  it('replaces a thinking-only sighting once the answer renders, even if the answer is shorter', async () => {
    const reasoning = 'the user is asking about X, so the relevant consideration is Y and then Z';
    const answer = 'yes';
    // The regression only exists when the answer loses a length comparison — pin that premise
    // rather than trusting the two literals to stay this way.
    expect(reasoning.length).toBeGreaterThan(answer.length);

    // The LAST turn, for the same reason the streaming test uses it: the walk starts at the
    // bottom, so this is the one row observed on the very first rounds — while it is still
    // thinking — and re-observed on the downward pass once the answer has landed. Any earlier
    // index is off-screen until well past `thinkingUntilRound` and never seen mid-thought,
    // which makes the test pass against the broken code.
    const turns = alternating(12);
    turns[11] = { ...turns[11], content: answer, thinking: reasoning, thinkingUntilRound: 2 };
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);
    expect(messages).toHaveLength(12);
    expect(messages[11].content).toBe(answer);
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

  // The declared total is an oracle, NOT a termination condition, and this is the test that
  // keeps it that way. Ending the walk once every declared position is filled looks safe and
  // is not: a position being FILLED is not a turn being FINISHED. The bottom turn of a
  // still-streaming response is captured as a fragment in the first round, then RECYCLED out
  // of the DOM as the walk moves up — after which no later round can grow it, because the
  // adapter can only re-read rows that are rendered. A walk that stopped on the count would
  // therefore never return to the bottom, and would export the fragment with no error
  // (AGENTS.md #4). Reviewers caught exactly this: an earlier revision of this branch ended at
  // round 17 exporting "the", where the undeclared path ran 32 rounds and exported the whole
  // answer.
  //
  // The geometry matters — 20 turns against a 250px viewport genuinely recycles. A shape where
  // every row stays rendered cannot reproduce it, which is why the first attempt at this test
  // passed against the broken code.
  it('does not let the declared total shorten the walk past a still-streaming turn', async () => {
    const turns = alternating(20);
    turns[19] = { ...turns[19], partial: true, content: 'the complete assistant answer' };
    const declared = makeWindowedDoc({ turns, setSize: 20 });
    const messages = await collectVirtualizedTurns(declared, fast);
    expect(messages[19].content).toBe('the complete assistant answer');
  });

  // The same invariant stated directly: knowing the total must not change how far the walk
  // goes. Any future attempt to end early on the count trips this, whatever shape it takes.
  it('walks exactly as far with a declared total as without one', async () => {
    const declared = makeWindowedDoc({ turns: alternating(20), setSize: 20 });
    const undeclared = makeWindowedDoc({ turns: alternating(20) });
    expect(await collectVirtualizedTurns(declared, fast)).toHaveLength(20);
    expect(await collectVirtualizedTurns(undeclared, fast)).toHaveLength(20);
    expect(roundsOf(declared)).toBe(roundsOf(undeclared));
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
