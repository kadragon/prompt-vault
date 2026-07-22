import { describe, it, expect } from 'vitest';
import { loadMoreConversations, loadMoreProjectConversations } from '../../../src/adapters/chatgpt';
import { ExtractionError } from '../../../src/core/errors';

// Build a fake list root whose rendered conversation-link count grows each time its
// scroll container is pinned to the bottom (scrollTop = scrollHeight), simulating
// ChatGPT's lazy-load of older sidebar/project rows as you scroll down. `runaway`
// never stops growing; otherwise it saturates at `maxRendered`. The root doubles as
// its own scroll container (scrollHeight > clientHeight) so `findScrollableAncestor`
// selects it.
function makeRoot({
  growPerStep,
  maxRendered,
  runaway = false,
  present = true,
}: {
  growPerStep: number;
  maxRendered: number;
  runaway?: boolean;
  present?: boolean;
}): { root: ParentNode; linkCount: () => number } {
  let rendered = 0;
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
      if (v === this.scrollHeight) {
        rendered = runaway ? rendered + growPerStep : Math.min(maxRendered, rendered + growPerStep);
      }
    },
    // Every list-link query on the root resolves to the current rendered count.
    querySelectorAll: (): { length: number } => ({ length: rendered }),
  };
  const root = {
    // `#history` and the project-link probe used by projectListSection both resolve to
    // the same fake list root when present.
    querySelector: () => (present ? listRoot : null),
    querySelectorAll: (sel: string) =>
      // projectListSection walks project links; give it one whose closest('section')
      // is the list root so it is discovered.
      sel.includes('/g/g-p-') && present
        ? [{ closest: () => listRoot } as unknown as Element]
        : [],
  } as unknown as ParentNode;
  return { root, linkCount: () => rendered };
}

const fast = { stepDelayMs: 0, stableRounds: 3, maxSteps: 50 };

describe('loadMoreConversations (history sidebar)', () => {
  it('scrolls until the rendered link count stabilizes, then returns', async () => {
    const { root, linkCount } = makeRoot({ growPerStep: 5, maxRendered: 20 });
    await expect(loadMoreConversations(root, fast)).resolves.toBeUndefined();
    expect(linkCount()).toBe(20);
  });

  it('returns immediately when the sidebar is absent', async () => {
    const { root } = makeRoot({ growPerStep: 5, maxRendered: 20, present: false });
    await expect(loadMoreConversations(root, fast)).resolves.toBeUndefined();
  });

  it('fails loud when links never stop appearing (runaway) within the step cap', async () => {
    const { root } = makeRoot({ growPerStep: 1, maxRendered: 0, runaway: true });
    await expect(
      loadMoreConversations(root, { stepDelayMs: 0, stableRounds: 3, maxSteps: 8 }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });
});

describe('loadMoreProjectConversations (project list)', () => {
  it('scrolls until the rendered link count stabilizes, then returns', async () => {
    const { root, linkCount } = makeRoot({ growPerStep: 4, maxRendered: 12 });
    await expect(loadMoreProjectConversations(root, fast)).resolves.toBeUndefined();
    expect(linkCount()).toBe(12);
  });

  it('returns immediately when the project list is absent', async () => {
    const { root } = makeRoot({ growPerStep: 4, maxRendered: 12, present: false });
    await expect(loadMoreProjectConversations(root, fast)).resolves.toBeUndefined();
  });

  it('fails loud on a runaway project list within the step cap', async () => {
    const { root } = makeRoot({ growPerStep: 1, maxRendered: 0, runaway: true });
    await expect(
      loadMoreProjectConversations(root, { stepDelayMs: 0, stableRounds: 3, maxSteps: 8 }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });
});
