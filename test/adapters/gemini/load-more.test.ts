import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { geminiAdapter } from '../../../src/adapters/gemini';
import { ExtractionError } from '../../../src/core/errors';

const ROW_SELECTOR = 'gem-nav-list-item[data-test-id="conversation"]';
const LINK_SELECTOR = 'a[href^="/app/"]';

// The measured geometry (2026-08-10): 32 px rows, plus ~256 px of non-row chrome inside the port —
// which is why the fake never lets a row count be derived from an absolute `scrollHeight`.
const ROW_HEIGHT = 32;
const PORT_CHROME_PX = 256;
// A viewport 12 rows tall, so stepping reaches the bottom in a few rounds instead of a dozen.
const VIEWPORT_ROWS = 12;

function idFor(index: number): string {
  return index.toString(16).padStart(16, '0');
}

interface SidebarOptions {
  /** Conversations the first render puts in the DOM. Measured: 31, against a page size of 20. */
  initial: number;
  /** Rows the server appends per page. Measured: 20. */
  pageSize?: number;
  /** Full pages left to serve after the initial render. */
  pages?: number;
  /** A terminal short page, appended after the full ones. Measured: 2. */
  lastPageRows?: number;
  /** Scroll rounds between the port reaching its bottom and the page landing. */
  fetchRounds?: number;
  /** A port that does not overflow — the sidebar is shorter than one viewport. */
  scrollable?: boolean;
  /** A list that appends forever, so only the step cap can end the walk. */
  runaway?: boolean;
}

/**
 * A Gemini history sidebar: **append-only, no recycling** (verified 2026-08-10 — rendered equalled
 * cumulative at every round and finished at 93 = 93), server-paged at a fixed size, with a page
 * landing one round after the port reaches its bottom. Deliberately NOT a recycling virtualizer:
 * that is ChatGPT's `#history` model and Gemini's own message list pages the other way, so
 * modelling either here would test a list Gemini does not have.
 */
function makeSidebar(options: SidebarOptions): { root: ParentNode; rendered: () => number } {
  const {
    initial,
    pageSize = 0,
    pages = 0,
    lastPageRows,
    fetchRounds = 1,
    scrollable = true,
    runaway = false,
  } = options;

  let rendered = initial;
  let served = 0;
  let top = 0;
  let countdown = 0;
  const clientHeight = scrollable
    ? ROW_HEIGHT * VIEWPORT_ROWS
    : PORT_CHROME_PX + ROW_HEIGHT * (initial + 1);

  const scrollHeight = (): number => PORT_CHROME_PX + rendered * ROW_HEIGHT;
  const maxTop = (): number => Math.max(0, scrollHeight() - clientHeight);
  const land = (): void => {
    const size = served < pages ? pageSize : (lastPageRows ?? 0);
    rendered += size;
    served++;
  };
  const pagesLeft = (): boolean => served < pages + (lastPageRows === undefined ? 0 : 1);

  const anchorAt = (index: number): Element =>
    ({
      getAttribute: (name: string): string | null => {
        if (name === 'href') return `/app/${idFor(index)}`;
        if (name === 'aria-label') return `Conversation ${index}`;
        return null;
      },
      textContent: `Conversation ${index}`,
    }) as unknown as Element;

  const scroller = {
    // The sidebar's own scroller carries no test id, so it never matches `scrollContainer`.
    matches: (): boolean => false,
    querySelector: (selector: string): Element | null => scroller.querySelectorAll(selector)[0] ?? null,
    querySelectorAll: (selector: string): Element[] => {
      if (selector === LINK_SELECTOR) return Array.from({ length: rendered }, (_, index) => anchorAt(index));
      if (selector === ROW_SELECTOR) return Array.from({ length: rendered }, () => ({}) as Element);
      return [];
    },
    parentElement: null,
    ownerDocument: { defaultView: null },
    clientHeight,
    get scrollHeight(): number {
      return scrollHeight();
    },
    get scrollTop(): number {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.min(value, maxTop());
      if (runaway) {
        rendered++;
        return;
      }
      if (countdown > 0) {
        countdown--;
        if (countdown === 0) land();
        return;
      }
      // A page is requested only once the walk has actually reached the bottom of the port.
      if (top >= maxTop() && pagesLeft()) countdown = fetchRounds;
    },
  };

  const root = {
    querySelectorAll: (selector: string): unknown[] => (selector === 'infinite-scroller' ? [scroller] : []),
  } as unknown as ParentNode;
  return { root, rendered: () => rendered };
}

// Fast knobs. `stableRounds` is 3 rather than 2 so the one quiet round the fake inserts while a
// page is in flight cannot be mistaken for the end of the list by the test harness itself.
const fast = { stepDelayMs: 0, stableRounds: 3, maxSteps: 300 };

describe('geminiAdapter.loadMoreConversations', () => {
  it('walks the nested scroll port rather than the sidebar scroller shell', async () => {
    const window = new Window();
    window.document.write(
      '<body><infinite-scroller><div id="port" style="overflow-y:auto">' +
        `<gem-nav-list-item data-test-id="conversation"><a href="/app/${idFor(1)}" aria-label="First">First</a></gem-nav-list-item>` +
        `<gem-nav-list-item data-test-id="conversation"><a href="/app/${idFor(2)}" aria-label="Second">Second</a></gem-nav-list-item>` +
        '</div></infinite-scroller></body>',
    );
    const port = window.document.getElementById('port')!;
    let top = 0;
    Object.defineProperties(port, {
      clientHeight: { configurable: true, value: 20 },
      scrollHeight: { configurable: true, value: 40 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = Math.min(value, 20);
        },
      },
    });

    const list = await geminiAdapter.loadMoreConversations?.(window.document as unknown as Document, {
      stepDelayMs: 0,
      stableRounds: 2,
      maxSteps: 10,
    });
    expect(top).toBe(20);
    expect(list?.map((conversation) => conversation.id)).toEqual([idFor(1), idFor(2)]);
  });

  it('accumulates every page across scroll rounds, deduped and in order', async () => {
    const progress: number[] = [];
    const { root } = makeSidebar({ initial: 31, pageSize: 20, pages: 3, lastPageRows: 2 });
    const list = await geminiAdapter.loadMoreConversations?.(root, {
      ...fast,
      onProgress: (loaded) => progress.push(loaded),
    });
    // The measured account exactly: 31 + 20 x 3 + 2 = 93.
    expect(list?.map((conversation) => conversation.id)).toEqual(Array.from({ length: 93 }, (_, i) => idFor(i)));
    // Every round re-reads the whole rendered list, so a duplicate tick would mean the id map
    // stopped deduping across rounds.
    expect(progress).toEqual([31, 51, 71, 91, 93]);
  });

  it('returns the rendered list without inventing paging when the port does not overflow', async () => {
    const { root } = makeSidebar({ initial: 2, scrollable: false });
    const list = await geminiAdapter.loadMoreConversations?.(root, { stepDelayMs: 0 });
    expect(list?.map((conversation) => conversation.id)).toEqual([idFor(0), idFor(1)]);
  });

  it('does not report progress for a scrollable sidebar that holds no conversations', async () => {
    // `onProgress` drives the panel's "loaded N" line, so a first round whose accumulation is
    // still empty must not tick: "0 conversations loaded" is not progress, it is the starting
    // state. Reachable whenever the port's own chrome makes it overflow an empty list.
    const window = new Window();
    window.document.write('<body><infinite-scroller id="port"></infinite-scroller></body>');
    const port = window.document.getElementById('port')!;
    let top = 0;
    Object.defineProperties(port, {
      clientHeight: { configurable: true, value: 20 },
      scrollHeight: { configurable: true, value: 40 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = Math.min(value, 20);
        },
      },
    });

    const progress: number[] = [];
    const list = await geminiAdapter.loadMoreConversations?.(window.document as unknown as Document, {
      stepDelayMs: 0,
      stableRounds: 2,
      maxSteps: 10,
      onProgress: (loaded) => progress.push(loaded),
    });
    expect(list).toEqual([]);
    expect(progress).toEqual([]);
  });

  it('fails loud when no sidebar scroller resolves', async () => {
    const root = { querySelectorAll: () => [] } as unknown as ParentNode;
    await expect(geminiAdapter.loadMoreConversations?.(root, { stepDelayMs: 0 })).rejects.toThrow(ExtractionError);
  });

  it('reports the step cap as incomplete while still returning what it loaded', async () => {
    const incomplete: boolean[] = [];
    const { root } = makeSidebar({ initial: 40, runaway: true });
    const list = await geminiAdapter.loadMoreConversations?.(root, {
      stepDelayMs: 0,
      stableRounds: 3,
      maxSteps: 6,
      onIncomplete: () => incomplete.push(true),
    });
    // `onIncomplete` is the shared partial-list signal (src/adapters/types.ts); throwing here
    // would strand the panel's incomplete branch and discard every id the walk did find.
    expect(incomplete).toEqual([true]);
    expect(list?.length).toBeGreaterThan(0);
  });

  describe('page-size parity', () => {
    it('warns when the list was cut on a full-page boundary, sizing the page from a batch not the initial render', async () => {
      // Two full 20-item pages after a 31-item initial render, then nothing more. The second
      // batch matches the size the first established, so a page may still be owed and the walk
      // must not present the list as complete.
      //
      // This is the case that pins the no-seed rule: seeding the size from the 31-row initial
      // render (which is what ChatGPT's gate does, because ITS first render measured one whole
      // page) leaves `pageSize` at 31, no 20-item batch can ever match it, and both assertions
      // below go silent.
      const incomplete: boolean[] = [];
      const sizes: number[] = [];
      const { root } = makeSidebar({ initial: 31, pageSize: 20, pages: 2 });
      const list = await geminiAdapter.loadMoreConversations?.(root, {
        ...fast,
        onIncomplete: () => incomplete.push(true),
        onPageSize: (size) => sizes.push(size),
      });
      expect(list).toHaveLength(71);
      expect(incomplete).toEqual([true]);
      expect(sizes).toEqual([20]);
    });

    it('treats a short terminal batch as the end of the list', async () => {
      // The measured shape: 31 + 20 x 3 + 2. The trailing 2-item page cannot be a full page, so
      // the list is complete and the user must not be warned about it.
      const incomplete: boolean[] = [];
      const { root } = makeSidebar({ initial: 31, pageSize: 20, pages: 3, lastPageRows: 2 });
      const list = await geminiAdapter.loadMoreConversations?.(root, {
        ...fast,
        onIncomplete: () => incomplete.push(true),
      });
      expect(list).toHaveLength(93);
      expect(incomplete).toEqual([]);
    });

    it('reports no page size until a batch has matched one', async () => {
      // One page after the initial render: the batch DEFINES the size rather than matching it, so
      // it is the gate's own guess and must not be handed back for a later walk to trust.
      const sizes: number[] = [];
      const incomplete: boolean[] = [];
      const { root } = makeSidebar({ initial: 31, pageSize: 20, pages: 1 });
      const list = await geminiAdapter.loadMoreConversations?.(root, {
        ...fast,
        onPageSize: (size) => sizes.push(size),
        onIncomplete: () => incomplete.push(true),
      });
      expect(list).toHaveLength(51);
      expect(sizes).toEqual([]);
      expect(incomplete).toEqual([]);
    });

    it('uses a page size an earlier walk reported when the first batch would only define one', async () => {
      // The re-run case `knownPageSize` exists for: with the size already known, the very first
      // full batch is evidence the list was cut on a boundary.
      const incomplete: boolean[] = [];
      const { root } = makeSidebar({ initial: 31, pageSize: 20, pages: 1 });
      await geminiAdapter.loadMoreConversations?.(root, {
        ...fast,
        knownPageSize: 20,
        onIncomplete: () => incomplete.push(true),
      });
      expect(incomplete).toEqual([true]);
    });
  });

  it('fails loud rather than walking a collapsed sidebar to an empty list', async () => {
    // Collapsed, the rows are there and the anchors are not (2026-08-10), so a walk would step
    // the port to the bottom and resolve `[]` — a full account reported as empty.
    const window = new Window();
    window.document.write(
      '<body><infinite-scroller>' +
        '<gem-nav-list-item data-test-id="conversation"><span>제목</span></gem-nav-list-item>' +
        '</infinite-scroller></body>',
    );
    await expect(
      geminiAdapter.loadMoreConversations?.(window.document as unknown as Document, { stepDelayMs: 0 }),
    ).rejects.toThrow(/collapsed/i);
  });
});
