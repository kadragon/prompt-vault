import { describe, it, expect } from 'vitest';
import {
  LOAD_OLDER_DEFAULTS_TEST,
  LOAD_OLDER_SETTLE_TEST,
  LOAD_OLDER_STATUS_EXTRA_ROUNDS_TEST,
  autoScrollToLoad,
} from '../../../src/adapters/chatgpt';
import { selectors } from '../../../src/adapters/chatgpt/selectors';
import { ExtractionError } from '../../../src/core/errors';

// A fake message viewport modelled on the app-shell list (measured 2026-09-29): it WINDOWS
// its turn nodes, so the rendered-node count stays flat while older turns mount, and only
// its `scrollHeight` grows. Each time the list is pinned to its top, one more "page" of
// height arrives — but only on every `every`-th pin, modelling the up-to-1.6 s gaps between
// batches. `reversed` lays it out `column-reverse`, where the top is the most negative
// `scrollTop` and `0` is the bottom. `loader` renders the thread's "loading earlier messages"
// status for as long as older turns remain (measured 2026-09-29: present from first paint,
// gone once the oldest turn mounts); `pinsWhenFull` records the pin count at that moment.
function makeDoc({
  growPx = 1000,
  maxHeight = 5000,
  every = 1,
  runaway = false,
  reversed = false,
  container = true,
  loader = false,
}: {
  growPx?: number;
  maxHeight?: number;
  every?: number;
  runaway?: boolean;
  reversed?: boolean;
  container?: boolean;
  loader?: boolean;
} = {}): { doc: Document; list: { scrollHeight: number; pins: number; pinsWhenFull: number } } {
  const clientHeight = 500;
  let top = reversed ? 0 : 10;
  const list = {
    clientHeight,
    scrollHeight: 1000,
    pins: 0,
    pinsWhenFull: -1,
    ownerDocument: reversed
      ? { defaultView: { getComputedStyle: () => ({ flexDirection: 'column-reverse' }) } }
      : undefined,
    get scrollTop(): number {
      return top;
    },
    set scrollTop(v: number) {
      const min = reversed ? -(list.scrollHeight - clientHeight) : 0;
      const max = reversed ? 0 : list.scrollHeight - clientHeight;
      top = Math.max(min, Math.min(max, v));
      if (top !== min) return; // only reaching the top mounts older turns
      list.pins++;
      if (list.pins % every !== 0) return;
      list.scrollHeight = runaway ? list.scrollHeight + growPx : Math.min(maxHeight, list.scrollHeight + growPx);
      if (list.pinsWhenFull < 0 && list.scrollHeight >= maxHeight) list.pinsWhenFull = list.pins;
    },
  };
  const doc = {
    querySelector: (sel: string) => {
      if (container && sel === selectors.scrollContainer) return list;
      if (loader && sel === selectors.olderTurnsLoading && list.scrollHeight < maxHeight) return {};
      return null;
    },
    querySelectorAll: () => ({ length: 6 }), // windowed: the node count never moves
  } as unknown as Document;
  return { doc, list };
}

describe('autoScrollToLoad', () => {
  it('keeps loading while the node count is flat but the list keeps growing', async () => {
    const { doc, list } = makeDoc();
    await expect(autoScrollToLoad(doc, { stepDelayMs: 0 })).resolves.toBeUndefined();
    expect(list.scrollHeight).toBe(5000);
  });

  it('waits out a gap between batches longer than a few rounds', async () => {
    // A batch every 10th pin. The pre-app-shell settings gave up after 3 still rounds,
    // which here would stop at the second page of five.
    const { doc, list } = makeDoc({ every: 10 });
    await autoScrollToLoad(doc, { stepDelayMs: 0 });
    expect(list.scrollHeight).toBe(5000);
  });

  it('pins a column-reverse list to its top (negative scrollTop), not to 0 — its bottom', async () => {
    const { doc, list } = makeDoc({ reversed: true });
    await autoScrollToLoad(doc, { stepDelayMs: 0 });
    expect(list.scrollHeight).toBe(5000);
  });

  it('returns immediately when no scroll container is present', async () => {
    const { doc } = makeDoc({ container: false });
    await expect(autoScrollToLoad(doc, { stepDelayMs: 0 })).resolves.toBeUndefined();
  });

  it('fails loud when the list never stops growing (runaway) within the step cap', async () => {
    const { doc } = makeDoc({ runaway: true });
    await expect(autoScrollToLoad(doc, { stepDelayMs: 0, stableRounds: 3, maxSteps: 8 })).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });

  it('does not fail when the container never reaches its top but the height is stable', async () => {
    // Completion is decided by height stability, not by where `scrollTop` sits.
    const stubborn = {
      clientHeight: 500,
      scrollHeight: 3000,
      get scrollTop(): number {
        return 25;
      },
      set scrollTop(_v: number) {
        /* ignore — never reaches the top */
      },
    };
    const doc = {
      querySelector: (sel: string) => (sel === selectors.scrollContainer ? stubborn : null),
      querySelectorAll: () => ({ length: 3 }),
    } as unknown as Document;
    await expect(autoScrollToLoad(doc, { stepDelayMs: 0 })).resolves.toBeUndefined();
  });

  it('ends shortly after the loading-earlier-messages status clears, not after the full dwell', async () => {
    const { doc, list } = makeDoc({ loader: true });
    await autoScrollToLoad(doc, { stepDelayMs: 0 });
    expect(list.scrollHeight).toBe(5000);
    const { stableRounds = 0 } = LOAD_OLDER_DEFAULTS_TEST;
    expect(list.pins - list.pinsWhenFull).toBeLessThan(stableRounds);
  });

  it('keeps the full dwell when the status was never seen — its absence proves nothing', async () => {
    // A short conversation never renders the status, but neither does a long one whose status
    // markup drifted; ending early on absence would silently drop that one's oldest turns.
    const { doc, list } = makeDoc();
    await autoScrollToLoad(doc, { stepDelayMs: 0 });
    const { stableRounds = 0 } = LOAD_OLDER_DEFAULTS_TEST;
    expect(list.pins - list.pinsWhenFull).toBeGreaterThanOrEqual(stableRounds);
  });

  it('keeps waiting past the dwell while the status still shows', async () => {
    // A batch gap longer than the dwell: the status says older turns remain, so the walk may
    // not give up on time alone (the step cap stays the fail-loud bound).
    const { stableRounds = 0 } = LOAD_OLDER_DEFAULTS_TEST;
    const { doc, list } = makeDoc({ loader: true, every: stableRounds * 2 });
    await autoScrollToLoad(doc, { stepDelayMs: 0 });
    expect(list.scrollHeight).toBe(5000);
  });

  it('fails loud when the status stays up and nothing more arrives', async () => {
    // A stuck fetch (measured on the sidebar as a 429 that left its loading row up): the
    // oldest turns will never come, so ending quietly on the dwell would drop them silently.
    const { doc } = makeDoc({ loader: true, maxHeight: 3000 });
    const stuck = doc.querySelector.bind(doc);
    const always = { ...doc, querySelector: (sel: string) => (sel === selectors.olderTurnsLoading ? {} : stuck(sel)) };
    await expect(autoScrollToLoad(always as unknown as Document, { stepDelayMs: 0 })).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });

  it('holds a stuck status well past the slowest measured batch gap before failing', () => {
    const { stepDelayMs = 0, stableRounds = 0 } = LOAD_OLDER_DEFAULTS_TEST;
    expect(stepDelayMs * (stableRounds + LOAD_OLDER_STATUS_EXTRA_ROUNDS_TEST)).toBeGreaterThan(3 * 4533);
  });

  it('settles longer than the last height change measured after the status cleared', () => {
    // 2026-09-29: the status vanished with the final batch; the height moved once more
    // (-58 px) 244 ms later (docs/live-dom-verification.md).
    const { stepDelayMs = 0, stableRounds = 0 } = LOAD_OLDER_SETTLE_TEST;
    expect(stepDelayMs * stableRounds).toBeGreaterThan(244);
  });

  it('dwells longer than the slowest batch gap measured live', () => {
    // 2026-09-29: first batch up to 4533 ms after the first pin, later ones at most 1602 ms
    // apart (docs/live-dom-verification.md). A dwell below either ends the load early and
    // silently drops the oldest turns.
    const { stepDelayMs = 0, stableRounds = 0 } = LOAD_OLDER_DEFAULTS_TEST;
    expect(stepDelayMs * stableRounds).toBeGreaterThan(4533);
  });
});
