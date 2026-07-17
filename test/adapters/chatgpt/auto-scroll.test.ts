import { describe, it, expect } from 'vitest';
import { autoScrollToLoad } from '../../../src/adapters/chatgpt';
import { ExtractionError } from '../../../src/core/errors';

// Build a fake document whose "message count" grows each time the scroll container
// is pinned to the top (scrollTop = 0), simulating ChatGPT's lazy load of older
// turns. `runaway` never stops growing; otherwise it saturates at `maxRendered`.
function makeDoc({
  growPerStep,
  maxRendered,
  runaway = false,
  container = true,
}: {
  growPerStep: number;
  maxRendered: number;
  runaway?: boolean;
  container?: boolean;
}): Document {
  let rendered = 0;
  const scrollContainer = {
    _top: 10,
    get scrollTop(): number {
      return this._top;
    },
    set scrollTop(v: number) {
      this._top = v;
      if (v === 0) rendered = runaway ? rendered + growPerStep : Math.min(maxRendered, rendered + growPerStep);
    },
  };
  return {
    querySelector: () => (container ? scrollContainer : null),
    querySelectorAll: () => ({ length: rendered }),
  } as unknown as Document;
}

const fast = { stepDelayMs: 0, stableRounds: 3, maxSteps: 50 };

describe('autoScrollToLoad', () => {
  it('scrolls until the rendered count stabilizes, then returns', async () => {
    const doc = makeDoc({ growPerStep: 2, maxRendered: 6 });
    await expect(autoScrollToLoad(doc, fast)).resolves.toBeUndefined();
    // All lazy turns were pulled in before the loop settled.
    expect(doc.querySelectorAll('[data-message-author-role]').length).toBe(6);
  });

  it('returns immediately when no scroll container is present', async () => {
    const doc = makeDoc({ growPerStep: 2, maxRendered: 6, container: false });
    await expect(autoScrollToLoad(doc, fast)).resolves.toBeUndefined();
  });

  it('fails loud when turns never stop appearing (runaway) within the step cap', async () => {
    const doc = makeDoc({ growPerStep: 1, maxRendered: 0, runaway: true });
    await expect(autoScrollToLoad(doc, { stepDelayMs: 0, stableRounds: 3, maxSteps: 8 })).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });

  it('does not fail when the container never reaches scrollTop 0 but the count is stable', async () => {
    // Container whose scrollTop write is ignored (stays non-zero); count is already
    // stable, so completion must be decided by count stability, not scrollTop.
    const stubborn = {
      get scrollTop(): number {
        return 25;
      },
      set scrollTop(_v: number) {
        /* ignore — never settles to 0 */
      },
    };
    const doc = {
      querySelector: () => stubborn,
      querySelectorAll: () => ({ length: 3 }),
    } as unknown as Document;
    await expect(autoScrollToLoad(doc, fast)).resolves.toBeUndefined();
  });
});
