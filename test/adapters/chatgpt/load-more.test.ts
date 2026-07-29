import { describe, it, expect, vi } from 'vitest';
import {
  loadMoreConversations,
  loadMoreProjectConversations,
  SIDEBAR_SCROLL_DEFAULTS_TEST,
} from '../../../src/adapters/chatgpt';
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
// `gap` marks a half-open index range whose rows render WITHOUT a `/c/` href — the shape of
// the sidebar's date dividers and non-conversation rows. A gap wider than the viewport keeps
// the conversation count flat for several consecutive windows in the middle of the list.
const ROW = 40;
function makeRoot({
  total,
  windowSize = Infinity,
  runaway = false,
  present = true,
  gap,
  clampTop,
}: {
  total: number;
  windowSize?: number;
  runaway?: boolean;
  present?: boolean;
  gap?: [number, number];
  clampTop?: number;
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
      const href = gap && i >= gap[0] && i < gap[1] ? null : `/c/${i}`;
      arr.push({
        getAttribute: (name: string) => (name === 'href' ? href : null),
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
      this._top = Math.min(v, clampTop ?? heightOf());
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

// Build a fake `#history` sidebar as a **server-paged, append-only lazy list** — the shape
// live measurement found on a 1042-conversation account: the rendered node count grows
// monotonically and never recycles (2026-07-24), and reaching the bottom triggers a server
// round-trip that appends the next page (757–6123 ms, re-measured 2026-07-29 over 37 pages;
// the 2026-07-24 reading of 1418–2830 ms understated it). `fetchMs` is that round-trip;
// `hydrateRounds` is how many further re-reads the landed rows stay href-less (present in
// the DOM, raising the container height, but not yet countable conversations).
//
// `cPerPage` models the split measured 2026-07-29: a page is a FIXED `pageSize` rows, but
// only some are top-level `/c/` conversations — the rest are project/GPT-scoped
// `/g/g-p-…/c/` rows living in the same `#history`. The split varies page to page (measured:
// 15–27 of 28), which is why the `/c/` increment is not the page size. Defaults to an
// all-`/c/` page, leaving the pre-existing cases unchanged.
function makeLazyRoot({
  pageSize,
  pages,
  fetchMs,
  hydrateRounds = 0,
  view = 3,
  cPerPage = () => pageSize,
  lastPageRows,
}: {
  pageSize: number;
  pages: number;
  /** Round-trip for each page, by 0-based page index — measured live to vary 757-6123 ms. */
  fetchMs: number | ((page: number) => number);
  hydrateRounds?: number;
  view?: number;
  cPerPage?: (page: number) => number;
  /**
   * Rows in the final page, when the list does not divide evenly — the shape measured
   * 2026-07-29 (36 pages of 28, then 6). Omit for a list whose last page is full-size,
   * which is the case parity cannot distinguish from "one more page is still owed".
   */
  lastPageRows?: number;
}): { root: ParentNode; conversationCount: () => number } {
  const clientHeight = view * ROW;
  // Every rendered row's href, in DOM order. A page contributes `cPerPage(p)` plain rows
  // and `pageSize - cPerPage(p)` project-scoped ones.
  const hrefs: string[] = [];
  let nextPlain = 0;
  let nextProject = 0;
  let lastPageAdded = 0; // rows the newest page contributed — what hydration hides
  const addPage = (p: number): void => {
    const rows = p === pages - 1 && lastPageRows !== undefined ? lastPageRows : pageSize;
    const plain = Math.max(0, Math.min(rows, cPerPage(p)));
    // Plain rows keep the global sequential `/c/<n>` ids the all-`/c/` cases assert on.
    for (let i = 0; i < plain; i++) hrefs.push(`/c/${nextPlain++}`);
    for (let i = plain; i < rows; i++) hrefs.push(`/g/g-p-proj/c/p${nextProject++}`);
    lastPageAdded = rows;
  };
  addPage(0);
  let pagesIn = 1;
  let fetching = false;
  let reads = 0;
  let countableFromRead = 0; // reads before this still hide the newest page
  // The loader asks for two different row sets: `a[href^="/c/"]` (conversations it collects)
  // and `a[href*="/c/"]` (every conversation row, the parity counter). Honour the difference
  // — collapsing them is exactly the blindness this fixture exists to reproduce.
  const matches = (sel: string, href: string): boolean =>
    sel.includes('^=') ? href.startsWith('/c/') : href.includes('/c/');
  const anchorsFor = (sel: string, upTo: number): Element[] =>
    hrefs
      .slice(0, upTo)
      .filter((href) => matches(sel, href))
      .map(
        (href) =>
          ({
            getAttribute: (name: string) => (name === 'href' ? href : null),
            closest: () => listRoot,
            querySelector: () => null,
          }) as unknown as Element,
      );
  const maybeFetch = (): void => {
    if (fetching || pagesIn >= pages) return;
    if (listRoot._top + clientHeight < hrefs.length * ROW - 1) return; // more to scroll first
    fetching = true;
    const incoming = pagesIn;
    setTimeout(
      () => {
        addPage(incoming);
        pagesIn++;
        countableFromRead = reads + hydrateRounds + 1;
        fetching = false;
      },
      typeof fetchMs === 'function' ? fetchMs(incoming) : fetchMs,
    );
  };
  const listRoot = {
    get scrollHeight(): number {
      return hrefs.length * ROW;
    },
    clientHeight,
    parentElement: null,
    ownerDocument: { defaultView: null },
    _top: 0,
    get scrollTop(): number {
      return this._top;
    },
    set scrollTop(v: number) {
      this._top = Math.max(0, Math.min(v, hrefs.length * ROW - clientHeight));
      maybeFetch();
    },
    querySelectorAll: (sel: string): Element[] => {
      // Count only the collect query, which the loop makes exactly once per round. The
      // parity counter reads the same DOM in the same round and must not age hydration.
      if (sel.includes('^=')) reads++;
      return anchorsFor(sel, reads < countableFromRead ? hrefs.length - lastPageAdded : hrefs.length);
    },
  };
  const root = {
    querySelector: () => listRoot,
    querySelectorAll: (sel: string) =>
      sel.includes('/g/g-p-') ? [{ closest: () => listRoot } as unknown as Element] : [],
  } as unknown as ParentNode;
  return { root, conversationCount: (): number => nextPlain };
}

const fast = { stepDelayMs: 0, stableRounds: 3, maxSteps: 200 };

// The longest stretch during which the LOADER sees no progress, measured live (2026-07-29,
// 1042-conversation account, 37 consecutive pages). This — not the fetch alone — is what the
// dwell must outlast: every page is preceded by a 3-row render event carrying no hrefs, so
// the conversation count stays flat across both that event and the fetch behind it. Page
// fetches themselves ran 757-6123 ms, already more than double the 1418-2830 ms measured
// 2026-07-24. A lower bound: the sample tick between the two measured gaps is excluded
// (509 + 6123 ms). 2 of 37 page boundaries exceeded the 5000 ms dwell this replaced.
const LONGEST_LOADER_BLIND_MS = 6632;
// `SCALE` runs the production timings that much faster so a real-latency test stays a
// sub-second unit test.
const SCALE = 100;

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

  it('keeps walking past a run of item-less windows in the middle of the list', async () => {
    // Rows 5-19 carry no `/c/` href (date dividers / non-conversation rows), so the
    // conversation count holds flat for three consecutive windows well above the bottom.
    // Judging completion by count stability alone would call that "fully loaded" and return
    // the first 5 of 15 — a silent truncation (AGENTS.md #4).
    const { root } = makeRoot({ total: 30, windowSize: 5, gap: [5, 20] });
    const result = await loadMoreConversations(root, fast);
    expect(result.map((c) => c.id)).toEqual([...idsUpTo(5), ...Array.from({ length: 10 }, (_, i) => String(20 + i))]);
  });

  it('settles on a scroll port whose arithmetic bottom the list can never reach', async () => {
    // `findScrollableAncestor` resolves whichever ancestor actually scrolls, which can be a
    // port taller than the list it contains (the project page's stage: scrollH 730 > clientH
    // 400, per docs/live-dom-verification.md). Here it stops accepting scrollTop at 100, far
    // short of scrollHeight - clientHeight, so `scrollTop + clientHeight >= scrollHeight` is
    // never true. Judging the end by that arithmetic would burn the whole step cap and then
    // fail loud on a healthy, fully-rendered list.
    const { root } = makeRoot({ total: 20, clampTop: 100 });
    const result = await loadMoreConversations(root, fast);
    expect(result.map((c) => c.id)).toEqual(idsUpTo(20));
  });

  it('keeps waiting while a server-paged sidebar fetches its next page', async () => {
    // Each page costs a round-trip during which nothing changes: the count is flat and the
    // viewport sits at the (current) bottom, so only wall-clock patience gets the rest of the
    // history. Run the PRODUCTION dwell (`stableRounds` unchanged, `stepDelayMs` scaled) against
    // the slowest measured round-trip, likewise scaled: shrinking either constant below the
    // real latency fails here, not just in the arithmetic guard below. Timing jitter can only
    // lengthen a round, i.e. make the loader more patient, so this cannot flake the other way.
    const { stepDelayMs = 0, stableRounds, maxSteps } = SIDEBAR_SCROLL_DEFAULTS_TEST;
    const { root } = makeLazyRoot({ pageSize: 5, pages: 4, fetchMs: LONGEST_LOADER_BLIND_MS / SCALE });
    const result = await loadMoreConversations(root, { stepDelayMs: stepDelayMs / SCALE, stableRounds, maxSteps });
    expect(result.map((c) => c.id)).toEqual(idsUpTo(20));
  });

  it('keeps waiting while a landed page is still hydrating its hrefs', async () => {
    // The page is in the DOM (the container grew) but its rows have no href yet, so the
    // conversation count stays flat for two more rounds after the fetch resolves.
    const { root } = makeLazyRoot({ pageSize: 5, pages: 3, fetchMs: 0, hydrateRounds: 2 });
    const result = await loadMoreConversations(root, { stepDelayMs: 0, stableRounds: 2, maxSteps: 400 });
    expect(result.map((c) => c.id)).toEqual(idsUpTo(15));
  });

  it('waits out the slowest measured lazy-load round-trip by default', () => {
    // The timing test above proves the dwell works; this pins the margin in the abstract, so a
    // shrunk constant fails loudly instead of leaving the suite to rely on measured latency
    // staying put. Keeps the defaults from drifting back to the viewport's 450 ms window.
    const { stepDelayMs, stableRounds } = SIDEBAR_SCROLL_DEFAULTS_TEST;
    expect((stepDelayMs ?? 0) * (stableRounds ?? 0)).toBeGreaterThanOrEqual(LONGEST_LOADER_BLIND_MS * 1.5);
  });

  it('loads a list whose pages hide their size behind a varying /c/ split', async () => {
    // Reproduces the silent truncation measured live on 2026-07-25 (725 of 852, 14.9% lost,
    // status line cleared exactly as a complete run does). The shape that causes it, measured
    // 2026-07-29: a page is a FIXED number of rows, but the share of them that are top-level
    // `/c/` conversations varies (15-27 of 28), so the count the loader watches grows by a
    // different amount every page and can go flat for longer than the dwell.
    const { stepDelayMs = 0, stableRounds, maxSteps } = SIDEBAR_SCROLL_DEFAULTS_TEST;
    const plainPerPage = [8, 3, 6, 2];
    const { root } = makeLazyRoot({
      pageSize: 8,
      pages: 4,
      lastPageRows: 3,
      cPerPage: (p) => plainPerPage[p],
      fetchMs: LONGEST_LOADER_BLIND_MS / SCALE,
    });
    const result = await loadMoreConversations(root, { stepDelayMs: stepDelayMs / SCALE, stableRounds, maxSteps });
    expect(result.map((c) => c.id)).toEqual(idsUpTo(19));
  });

  it('keeps waiting on a gap longer than the dwell when parity says a page is still owed', async () => {
    // Isolates the oracle from the constant: this gap exceeds the *raised* dwell, so a bigger
    // number alone does not rescue it — only the structural evidence that the last page came
    // in full-size does. The gap is synthetic (chosen to sit between the dwell and the pending
    // budget), NOT a measured latency; the measured worst case is LONGEST_LOADER_BLIND_MS.
    //
    // The slow gap is the SECOND one on purpose. Parity is deliberately silent until it has
    // seen a page land, so the first boundary is covered by the dwell alone — putting the gap
    // there would test the constant again rather than the oracle.
    const { stepDelayMs = 0, stableRounds, maxSteps } = SIDEBAR_SCROLL_DEFAULTS_TEST;
    const dwellMs = (stepDelayMs / SCALE) * (stableRounds ?? 0);
    const gapMs = dwellMs * 1.5;
    const incomplete = vi.fn();
    const { root } = makeLazyRoot({
      pageSize: 6,
      pages: 3,
      lastPageRows: 2,
      fetchMs: (page) => (page === 1 ? 0 : gapMs),
    });
    const result = await loadMoreConversations(root, {
      stepDelayMs: stepDelayMs / SCALE,
      stableRounds,
      maxSteps,
      onIncomplete: incomplete,
    });
    expect(result.map((c) => c.id)).toEqual(idsUpTo(14));
    // The list ended on a SHORT page, which is the one thing parity can read as a real end.
    expect(incomplete).not.toHaveBeenCalled();
  });

  it('reports possible incompleteness when the list ends on a full-size page', async () => {
    // A history whose length is an exact multiple of the page size is indistinguishable from
    // one page short. Returning the rows is right (failing loud would break such accounts
    // permanently), but claiming completeness is not — so the caller is told (AGENTS.md #4).
    const incomplete = vi.fn();
    const { root } = makeLazyRoot({ pageSize: 5, pages: 3, fetchMs: 0 });
    const result = await loadMoreConversations(root, { ...fast, onIncomplete: incomplete });
    expect(result.map((c) => c.id)).toEqual(idsUpTo(15));
    expect(incomplete).toHaveBeenCalledTimes(1);
  });

  it('does not claim incompleteness for a history shorter than one page', async () => {
    // No page ever lands, so no increment is ever observed and the oracle must stay silent —
    // otherwise every small account would be warned on every load (a false alarm is as bad as
    // the silence this fix removes).
    const incomplete = vi.fn();
    const { root } = makeLazyRoot({ pageSize: 5, pages: 1, fetchMs: 0 });
    const result = await loadMoreConversations(root, { ...fast, onIncomplete: incomplete });
    expect(result.map((c) => c.id)).toEqual(idsUpTo(5));
    expect(incomplete).not.toHaveBeenCalled();
  });

  it('fails loud when new conversations never stop appearing (runaway) within the step cap', async () => {
    const { root } = makeRoot({ total: 10, windowSize: 4, runaway: true });
    await expect(
      loadMoreConversations(root, { stepDelayMs: 0, stableRounds: 3, maxSteps: 8 }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('reports onProgress with a non-decreasing sequence ending at the returned list length', async () => {
    const { root } = makeRoot({ total: 18, windowSize: 6 });
    const progress: number[] = [];
    const result = await loadMoreConversations(root, { ...fast, onProgress: (n) => progress.push(n) });
    expect(progress.length).toBeGreaterThan(0);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThan(progress[i - 1]);
    expect(progress[progress.length - 1]).toBe(result.length);
  });

  it('does not call onProgress on a round that surfaces no new conversation', async () => {
    // The gap holds the count flat for several rounds while the window steps across it
    // (see the item-less-windows test above) — a stall-round call here would mean the
    // panel's status line jumps backward or repeats a stale count.
    const { root } = makeRoot({ total: 30, windowSize: 5, gap: [5, 20] });
    const listRoot = (root as unknown as { querySelector: (s: string) => object }).querySelector('x') as {
      scrollTop: number;
    };
    let rounds = 0;
    const original = Object.getOwnPropertyDescriptor(listRoot, 'scrollTop')!;
    Object.defineProperty(listRoot, 'scrollTop', {
      get: (): number => original.get!.call(listRoot) as number,
      set: (v: number) => {
        rounds++;
        original.set!.call(listRoot, v);
      },
    });
    const progress: number[] = [];
    await loadMoreConversations(root, { ...fast, onProgress: (n) => progress.push(n) });
    // The round counter alone is too loose to discriminate — it exceeds the loop-iteration
    // count by enough slack to absorb a tick on every round. What a stall-round tick would
    // actually produce is a *repeated* count, so require every tick to report a strictly
    // larger one: that fails the moment the `current > lastCount` guard is dropped.
    expect(progress.length).toBeLessThan(rounds);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThan(progress[i - 1]);
  });

  it('omitting onProgress leaves the loop behavior unchanged', async () => {
    const { root: withCallback } = makeRoot({ total: 20, windowSize: 6 });
    const { root: withoutCallback } = makeRoot({ total: 20, windowSize: 6 });
    const a = await loadMoreConversations(withCallback, { ...fast, onProgress: () => {} });
    const b = await loadMoreConversations(withoutCallback, fast);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
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
