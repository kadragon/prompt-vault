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
// Each turn sits in its own `[data-index]` row (live: exactly one turn node per row, zero
// orphans), and its `data-index` is its conversation position (live: contiguous, and stable
// across a full up-then-down walk — zero index→role conflicts).
interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Renders hollow until fully inside the viewport — content arrives on a later sighting. */
  skeleton?: boolean;
  /** Empty at every scroll position: genuinely unreadable, must fail loud. */
  neverFills?: boolean;
  /** Row renders without a `data-index`, so the turn has no stable key. */
  unindexed?: boolean;
  /** Row renders with this index instead of its position — used to punch a hole. */
  indexOverride?: number;
}

const TURN_H = 100;

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

  const makeNode = (t: Turn, i: number) => {
    const hydrated = (): boolean => (t.skeleton ? fullyInside(i) : true);
    const text = (): string => {
      if (t.neverFills) return '';
      return hydrated() ? t.content : '';
    };
    const row = {
      getAttribute: (name: string): string | null =>
        name === 'data-index' && !t.unindexed ? String(t.indexOverride ?? i) : null,
    };
    // The turn node itself: a user bubble matches `[data-testid="user-message"]`; an
    // assistant node is the `.standard-markdown` container and matches neither.
    return {
      matches: (sel: string): boolean => sel === '[data-testid="user-message"]' && t.role === 'user',
      closest: (sel: string) => (sel === '[data-index]' && !t.unindexed ? row : null),
      // `readUserContent` walks `children`; giving it none makes it fall back to textContent.
      children: [] as Element[],
      get textContent(): string {
        return text();
      },
      // `htmlToMarkdown` (assistant path) walks childNodes; a single text node is enough.
      get childNodes(): unknown[] {
        return [{ nodeType: 3, textContent: text() }];
      },
    };
  };

  return {
    querySelector: (sel: string) => (sel === '[data-autoscroll-container]' ? container : null),
    querySelectorAll: (sel: string) =>
      sel === '[data-testid="user-message"], .standard-markdown'
        ? turns.map(makeNode).filter((_, i) => intersects(i))
        : [],
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

  it('fails loud when a turn never yields content (never silently drops it)', async () => {
    const turns = alternating(12);
    turns[4] = { ...turns[4], neverFills: true };
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toBeInstanceOf(
      ExtractionError,
    );
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
