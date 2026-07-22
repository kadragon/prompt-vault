import { describe, it, expect } from 'vitest';
import { loadMoreConversations, loadMoreProjectConversations } from '../../../src/adapters/chatgpt';
import { ExtractionError } from '../../../src/core/errors';

// Build a fake list root whose set of rendered conversation links grows each time its
// scroll container is pinned to the bottom (scrollTop = scrollHeight), simulating
// ChatGPT's lazy-load of older sidebar/project rows as you scroll down. Each link
// carries a distinct `/c/<n>` href so the loader's unique-id progress signal advances.
// `runaway` never stops growing; otherwise it saturates at `maxRendered`. `windowSize`
// caps how many links are simultaneously in the DOM (a recycled node pool) even as the
// distinct-id frontier keeps advancing — exercising the unique-id counting. The root
// doubles as its own scroll container so `findScrollableAncestor` selects it.
function makeRoot({
  growPerStep,
  maxRendered,
  runaway = false,
  present = true,
  windowSize = Infinity,
}: {
  growPerStep: number;
  maxRendered: number;
  runaway?: boolean;
  present?: boolean;
  windowSize?: number;
}): { root: ParentNode; frontier: () => number } {
  let loaded = 0; // distinct conversations surfaced so far
  const anchorsNow = (): Element[] => {
    const start = windowSize === Infinity ? 0 : Math.max(0, loaded - windowSize);
    const arr: Element[] = [];
    for (let i = start; i < loaded; i++) {
      arr.push({
        getAttribute: (name: string) => (name === 'href' ? `/c/${i}` : null),
        closest: () => listRoot,
        querySelector: () => null, // project-title lookup: falls back to the default title
      } as unknown as Element);
    }
    return arr;
  };
  const listRoot = {
    scrollHeight: 1000,
    clientHeight: 100,
    parentElement: null,
    ownerDocument: { defaultView: null }, // no getComputedStyle → ancestor accepted
    _top: 0,
    get scrollTop(): number {
      return this._top;
    },
    set scrollTop(v: number) {
      this._top = v;
      if (v === this.scrollHeight) loaded = runaway ? loaded + growPerStep : Math.min(maxRendered, loaded + growPerStep);
    },
    querySelectorAll: (): Element[] => anchorsNow(),
  };
  const root = {
    // `#history` resolves to the list root; projectListSection walks a project link
    // whose closest('section') is the same list root.
    querySelector: () => (present ? listRoot : null),
    querySelectorAll: (sel: string) =>
      sel.includes('/g/g-p-') && present ? [{ closest: () => listRoot } as unknown as Element] : [],
  } as unknown as ParentNode;
  return { root, frontier: () => loaded };
}

const fast = { stepDelayMs: 0, stableRounds: 3, maxSteps: 50 };

// The stable `/c/<n>` ids the loader is expected to return, in order, for a list of `n`.
const idsUpTo = (n: number): string[] => Array.from({ length: n }, (_, i) => String(i));

describe('loadMoreConversations (history sidebar)', () => {
  it('scrolls until no new conversation id appears, returning the full list', async () => {
    const { root, frontier } = makeRoot({ growPerStep: 5, maxRendered: 20 });
    const result = await loadMoreConversations(root, fast);
    expect(frontier()).toBe(20);
    expect(result.map((c) => c.id)).toEqual(idsUpTo(20));
  });

  it('returns EVERY row under windowed/recycling virtualization (trimmed-off-top preserved)', async () => {
    // Only 6 links are ever in the DOM at once — earlier rows are trimmed off the top as
    // the id frontier advances to 18. A single post-scroll re-scan would see just the last
    // 6; accumulating across rounds must return all 18, in order.
    const { root, frontier } = makeRoot({ growPerStep: 3, maxRendered: 18, windowSize: 6 });
    const result = await loadMoreConversations(root, fast);
    expect(frontier()).toBe(18);
    expect(result.map((c) => c.id)).toEqual(idsUpTo(18));
  });

  it('returns [] when the sidebar is absent', async () => {
    const { root } = makeRoot({ growPerStep: 5, maxRendered: 20, present: false });
    await expect(loadMoreConversations(root, fast)).resolves.toEqual([]);
  });

  it('fails loud when new conversations never stop appearing (runaway) within the step cap', async () => {
    const { root } = makeRoot({ growPerStep: 1, maxRendered: 0, runaway: true });
    await expect(
      loadMoreConversations(root, { stepDelayMs: 0, stableRounds: 3, maxSteps: 8 }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });
});

describe('loadMoreProjectConversations (project list)', () => {
  it('scrolls until no new conversation id appears, returning the full list', async () => {
    const { root, frontier } = makeRoot({ growPerStep: 4, maxRendered: 12 });
    const result = await loadMoreProjectConversations(root, fast);
    expect(frontier()).toBe(12);
    expect(result.map((c) => c.id)).toEqual(idsUpTo(12));
  });

  it('returns EVERY row under windowed/recycling virtualization (trimmed-off-top preserved)', async () => {
    const { root, frontier } = makeRoot({ growPerStep: 4, maxRendered: 16, windowSize: 5 });
    const result = await loadMoreProjectConversations(root, fast);
    expect(frontier()).toBe(16);
    expect(result.map((c) => c.id)).toEqual(idsUpTo(16));
  });

  it('returns [] when the project list is absent', async () => {
    const { root } = makeRoot({ growPerStep: 4, maxRendered: 12, present: false });
    await expect(loadMoreProjectConversations(root, fast)).resolves.toEqual([]);
  });

  it('fails loud on a runaway project list within the step cap', async () => {
    const { root } = makeRoot({ growPerStep: 1, maxRendered: 0, runaway: true });
    await expect(
      loadMoreProjectConversations(root, { stepDelayMs: 0, stableRounds: 3, maxSteps: 8 }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });
});
