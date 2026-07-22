import { describe, it, expect } from 'vitest';
import { loadMoreConversations, loadMoreProjectConversations } from '../../../src/adapters/chatgpt';
import { ExtractionError } from '../../../src/core/errors';

// Build a fake list root modelling ChatGPT's virtualized history sidebar / project list
// as a **spacer-height recycling virtualizer**: all `total` conversations exist from the
// start and the container reports its full height up front (`total * ROW`), but only a
// `windowSize`-row window around the current scroll offset is ever in the DOM (earlier and
// later rows are recycled out). This is the worst case for the loader: a single jump to
// `scrollHeight` would render only the final window and skip everything in between — the
// loader must STEP through each window to see every row. Each rendered link carries a
// distinct `/c/<n>` href. `runaway` makes new rows keep appearing forever (never settles).
// The root doubles as its own scroll container so `findScrollableAncestor` selects it.
const ROW = 40;
function makeRoot({
  total,
  windowSize = Infinity,
  runaway = false,
  present = true,
}: {
  total: number;
  windowSize?: number;
  runaway?: boolean;
  present?: boolean;
}): { root: ParentNode } {
  const winRows = windowSize === Infinity ? Number.MAX_SAFE_INTEGER : windowSize;
  // Viewport height: exactly `windowSize` rows (a small fixed viewport when unwindowed).
  const clientHeight = (windowSize === Infinity ? 10 : windowSize) * ROW;
  let grown = total; // runaway: rows keep being appended below as we scroll
  const rowCount = (): number => (runaway ? grown : total);
  const heightOf = (): number => rowCount() * ROW;
  // The window of rows rendered for a given scroll offset: the `windowSize` rows starting
  // at the row nearest `top`, clamped so the last window sits flush against the bottom.
  const anchorsAt = (top: number): Element[] => {
    const count = rowCount();
    const first = Math.min(Math.max(0, Math.floor(top / ROW)), Math.max(0, count - winRows));
    const last = Math.min(count, first + winRows);
    const arr: Element[] = [];
    for (let i = first; i < last; i++) {
      arr.push({
        getAttribute: (name: string) => (name === 'href' ? `/c/${i}` : null),
        closest: () => listRoot,
        querySelector: () => null, // project-title lookup: falls back to the default title
      } as unknown as Element);
    }
    return arr;
  };
  const listRoot = {
    get scrollHeight(): number {
      return heightOf();
    },
    clientHeight,
    parentElement: null,
    ownerDocument: { defaultView: null }, // no getComputedStyle → ancestor accepted
    _top: 0,
    get scrollTop(): number {
      return this._top;
    },
    set scrollTop(v: number) {
      this._top = Math.min(v, heightOf());
      if (runaway) grown += winRows; // never settles: more rows keep surfacing below
    },
    querySelectorAll: (): Element[] => anchorsAt(listRoot._top),
  };
  const root = {
    // `#history` resolves to the list root; projectListSection walks a project link
    // whose closest('section') is the same list root.
    querySelector: () => (present ? listRoot : null),
    querySelectorAll: (sel: string) =>
      sel.includes('/g/g-p-') && present ? [{ closest: () => listRoot } as unknown as Element] : [],
  } as unknown as ParentNode;
  return { root };
}

const fast = { stepDelayMs: 0, stableRounds: 3, maxSteps: 200 };

// The stable `/c/<n>` ids the loader is expected to return, in order, for a list of `n`.
const idsUpTo = (n: number): string[] => Array.from({ length: n }, (_, i) => String(i));

describe('loadMoreConversations (history sidebar)', () => {
  it('returns the full list for a non-recycling sidebar (whole list in the DOM)', async () => {
    const { root } = makeRoot({ total: 20 });
    const result = await loadMoreConversations(root, fast);
    expect(result.map((c) => c.id)).toEqual(idsUpTo(20));
  });

  it('returns EVERY row under a spacer-height recycling virtualizer (middle windows not skipped)', async () => {
    // Only 6 rows are ever in the DOM at once and the container knows its full height up
    // front, so a jump to the bottom would render just the last window (missing rows
    // ~6-11) — stepping through each window must still collect all 18, in order.
    const { root } = makeRoot({ total: 18, windowSize: 6 });
    const result = await loadMoreConversations(root, fast);
    expect(result.map((c) => c.id)).toEqual(idsUpTo(18));
  });

  it('returns [] when the sidebar is absent', async () => {
    const { root } = makeRoot({ total: 20, present: false });
    await expect(loadMoreConversations(root, fast)).resolves.toEqual([]);
  });

  it('fails loud when new conversations never stop appearing (runaway) within the step cap', async () => {
    const { root } = makeRoot({ total: 10, windowSize: 4, runaway: true });
    await expect(
      loadMoreConversations(root, { stepDelayMs: 0, stableRounds: 3, maxSteps: 8 }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });
});

describe('loadMoreProjectConversations (project list)', () => {
  it('returns the full list for a non-recycling project list', async () => {
    const { root } = makeRoot({ total: 12 });
    const result = await loadMoreProjectConversations(root, fast);
    expect(result.map((c) => c.id)).toEqual(idsUpTo(12));
  });

  it('returns EVERY row under a spacer-height recycling virtualizer (middle windows not skipped)', async () => {
    const { root } = makeRoot({ total: 16, windowSize: 5 });
    const result = await loadMoreProjectConversations(root, fast);
    expect(result.map((c) => c.id)).toEqual(idsUpTo(16));
  });

  it('returns [] when the project list is absent', async () => {
    const { root } = makeRoot({ total: 12, present: false });
    await expect(loadMoreProjectConversations(root, fast)).resolves.toEqual([]);
  });

  it('fails loud on a runaway project list within the step cap', async () => {
    const { root } = makeRoot({ total: 10, windowSize: 4, runaway: true });
    await expect(
      loadMoreProjectConversations(root, { stepDelayMs: 0, stableRounds: 3, maxSteps: 8 }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });
});
