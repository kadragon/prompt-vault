import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { collectPagedExchanges } from '../../../src/adapters/gemini';
import { ExtractionError } from '../../../src/core/errors';

// Model Gemini's LAZY PAGING, the shape live measurement found on 2026-07-25
// (docs/live-dom-verification.md → Gemini): a fresh load renders only the newest `pageSize`
// exchanges, and reaching the top of the loaded range is what triggers the next batch of
// older ones. Nothing is ever trimmed, so the DOM grows monotonically — the opposite of
// Claude's recycling message list.
//
// Two details make this a real test rather than a rubber stamp:
//   - the older batch is PREPENDED, and `scrollTop` is bumped by the prepended height, the way
//     a browser preserves visual position when content is inserted above. So a walk cannot
//     reach the true top in one jump: it must keep climbing as the list grows underneath it.
//   - the batch arrives only when the walk is already at `scrollTop <= 0` — the exact moment a
//     "am I at the top?" termination check would fire.
// Both are why `docs/conventions.md` bans a jump-to-end fake: it would hide the bug entirely.

const EXCHANGE_H = 500;

interface PagedOptions {
  /** Total exchanges in the conversation, only some of which are rendered at first. */
  total: number;
  /** How many the initial render holds, and how many arrive per batch. Live: 10. */
  pageSize?: number;
  clientHeight?: number;
  /** Container ignores scroll writes, so the walk can never reach the top. */
  stuck?: boolean;
  /**
   * Once everything has loaded, drop back to this many rendered exchanges — models a
   * recycling window appearing at a scale the live session never reached. The append-only
   * premise the single final read rests on must be guarded, not assumed.
   */
  trimTo?: number;
  /** Render the newest response as still generating (`aria-busy="true"`). */
  streamingLast?: boolean;
  /**
   * Make a batch arrive this many rounds AFTER the walk reaches the top, with `scrollTop`
   * staying at 0 in the meantime — a data load in flight, rather than the synchronous
   * position-preserving insert the default models. This is the shape the walk's
   * "is the list still changing?" settle condition exists for: position alone says "at the
   * top, nothing to do" during every one of those rounds.
   */
  batchDelayRounds?: number;
}

interface PagedDoc {
  doc: Document;
  container: { scrollTop: number };
  /** Exchanges rendered right now — the sanity check that the fake really does withhold. */
  rendered: () => number;
}

function makePagedDoc({
  total,
  pageSize = 10,
  clientHeight = 836,
  stuck = false,
  trimTo,
  streamingLast = false,
  batchDelayRounds = 0,
}: PagedOptions): PagedDoc {
  const window = new Window();
  const doc = window.document as unknown as Document;
  doc.write(
    '<html><head><title>Paged fixture - Google Gemini</title></head><body>' +
      '<infinite-scroller data-test-id="chat-history-container"></infinite-scroller>' +
      '</body></html>',
  );
  const scroller = doc.querySelector('infinite-scroller') as unknown as HTMLElement;

  // Loaded exchanges are the window [from, to] of conversation positions.
  let from = Math.max(0, total - pageSize);
  const to = total - 1;
  let trimmed = false;

  const exchangeHtml = (i: number): string =>
    `<div class="conversation-container" id="ex${i}">` +
    '<user-query><div class="query-text">' +
    '<span class="cdk-visually-hidden">말씀하신 내용</span>' +
    `<p class="query-text-line">q ${i}</p>` +
    '</div></user-query>' +
    `<model-response><div class="markdown" aria-busy="${
      streamingLast && i === to ? 'true' : 'false'
    }"><p>a ${i}</p></div></model-response>` +
    '</div>';

  const render = (): void => {
    const html: string[] = [];
    for (let i = from; i <= to; i++) html.push(exchangeHtml(i));
    scroller.innerHTML = html.join('');
  };
  render();

  const loadedCount = (): number => to - from + 1;
  const scrollHeight = (): number => loadedCount() * EXCHANGE_H;
  let top = Math.max(0, scrollHeight() - clientHeight);

  // Rounds remaining until an in-flight batch lands (0 = nothing in flight). Counted down by
  // the exchange query, which the walk runs exactly once per round.
  let pendingRounds = 0;
  const landBatch = (): void => {
    const batch = Math.min(pageSize, from);
    from -= batch;
    render();
    // `top` deliberately untouched: this models a load that does NOT shift the viewport, so
    // the walk's position stays 0 across the arrival.
  };
  if (batchDelayRounds > 0) {
    const exchangeQuery = doc.querySelectorAll.bind(doc);
    (doc as unknown as { querySelectorAll: (sel: string) => NodeListOf<Element> }).querySelectorAll =
      (sel: string) => {
        if (sel === 'div.conversation-container' && pendingRounds > 0 && --pendingRounds === 0) {
          landBatch();
        }
        return exchangeQuery(sel);
      };
  }

  Object.defineProperty(scroller, 'clientHeight', { get: () => clientHeight });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => scrollHeight() });
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      if (stuck) return;
      let next = Math.max(0, Math.min(v, Math.max(0, scrollHeight() - clientHeight)));
      if (next <= 0 && !trimmed) {
        if (from > 0) {
          // Reaching the top of the loaded range pages in the next batch of older exchanges.
          if (batchDelayRounds > 0) {
            // In flight: nothing changes for `batchDelayRounds` rounds, and the viewport does
            // not move when it finally lands.
            if (pendingRounds === 0) pendingRounds = batchDelayRounds;
          } else {
            const batch = Math.min(pageSize, from);
            from -= batch;
            render();
            // The browser keeps the visual position: content inserted above pushes it down.
            next = batch * EXCHANGE_H;
          }
        } else if (trimTo !== undefined && loadedCount() > trimTo) {
          from = to - trimTo + 1;
          render();
          trimmed = true;
        }
      }
      top = next;
    },
  });

  return {
    doc,
    container: scroller,
    rendered: () => doc.querySelectorAll('div.conversation-container').length,
  };
}

const fast = { stepDelayMs: 0 };

describe('collectPagedExchanges — lazily paged exchange list', () => {
  it('loads every withheld exchange, though only a page of them exists in the DOM at first', async () => {
    const paged = makePagedDoc({ total: 16 });

    // Sanity: the fake really does withhold — the live numbers were 10 of 16 on load.
    expect(paged.rendered()).toBe(10);

    const messages = await collectPagedExchanges(paged.doc, fast);
    // One prompt + one reply per exchange.
    expect(messages).toHaveLength(32);
    expect(paged.rendered()).toBe(16);
  });

  it('returns exchanges in conversation order, oldest first', async () => {
    const messages = await collectPagedExchanges(makePagedDoc({ total: 16 }).doc, fast);
    expect(messages.slice(0, 4).map((m) => m.content)).toEqual(['q 0', 'a 0', 'q 1', 'a 1']);
    expect(messages[31].content).toBe('a 15');
    expect(messages.map((m) => m.role).slice(0, 4)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('keeps paging through several batches, not just the first', async () => {
    // 34 exchanges against a page size of 10 needs three separate batch loads, each triggered
    // only once the walk has climbed to the top of what is already there.
    const messages = await collectPagedExchanges(makePagedDoc({ total: 34 }).doc, fast);
    expect(messages).toHaveLength(68);
    expect(messages[0].content).toBe('q 0');
  });

  it('exports a conversation that fits in the first page without any paging', async () => {
    const messages = await collectPagedExchanges(makePagedDoc({ total: 3 }).doc, fast);
    expect(messages).toHaveLength(6);
  });

  // The settle condition, stated as the failure it prevents. Here each batch is IN FLIGHT for
  // a few rounds and lands without moving the viewport, so `scrollTop <= 0` is true — and
  // "nothing left to load" is false — on every one of those rounds. A walk that ended on
  // position alone runs out its dwell partway through the paging and exports a prefix of the
  // conversation with no error: the silent truncation this whole design exists to prevent
  // (AGENTS.md #4).
  //
  // 36 exchanges is three batches deep on purpose. At two batches this test passes either way
  // — both happen to land inside a single dwell window, so position-only termination collects
  // everything by luck and the assertion proves nothing. Verified to fail under a targeted
  // neutralization (docs/conventions.md): dropping the `unchanged` term from the settle
  // condition in `walkToTop` turns this red at 60 of 72 messages, while every other test in
  // this file stays green.
  it('keeps waiting while a batch is still in flight, not merely until it is at the top', async () => {
    const paged = makePagedDoc({ total: 36, batchDelayRounds: 3 });
    const messages = await collectPagedExchanges(paged.doc, fast);
    expect(messages).toHaveLength(72);
    expect(messages[0].content).toBe('q 0');
    expect(paged.rendered()).toBe(36);
  });

  // The guard that makes the single ordered final read safe. Live measurement found the list
  // append-only at 11 and 16 exchanges; if a recycling window ever appears at a larger scale,
  // the final read would silently return only what is left instead of the whole conversation.
  it('fails loud when exchanges are dropped after being loaded', async () => {
    const paged = makePagedDoc({ total: 16, trimTo: 6 });
    await expect(collectPagedExchanges(paged.doc, fast)).rejects.toThrow(
      /of 16 loaded messages are still on the page/,
    );
  });

  it('fails loud when a response is still generating, instead of exporting a fragment', async () => {
    const paged = makePagedDoc({ total: 12, streamingLast: true });
    await expect(collectPagedExchanges(paged.doc, fast)).rejects.toThrow(/still generating/);
  });

  it('fails loud when the container never reaches the top (stuck scroll)', async () => {
    const paged = makePagedDoc({ total: 16, stuck: true });
    await expect(collectPagedExchanges(paged.doc, fast)).rejects.toBeInstanceOf(ExtractionError);
  });

  it('fails loud when the step cap is hit before the list finishes paging', async () => {
    const paged = makePagedDoc({ total: 34 });
    await expect(collectPagedExchanges(paged.doc, { ...fast, maxSteps: 4 })).rejects.toThrow(
      /Timed out scrolling back to the start/,
    );
  });

  it('puts the user back where they were reading, including after a failure', async () => {
    const paged = makePagedDoc({ total: 16 });
    const before = paged.container.scrollTop;
    expect(before).toBeGreaterThan(0);
    await collectPagedExchanges(paged.doc, fast);
    expect(paged.container.scrollTop).toBe(before);

    const failing = makePagedDoc({ total: 16, stuck: true });
    const beforeFail = failing.container.scrollTop;
    await expect(collectPagedExchanges(failing.doc, fast)).rejects.toBeInstanceOf(ExtractionError);
    expect(failing.container.scrollTop).toBe(beforeFail);
  });

  it('falls back to a one-shot read when there is no scroll container', async () => {
    const paged = makePagedDoc({ total: 4, pageSize: 4 });
    const noContainer = {
      querySelector: () => null,
      querySelectorAll: (sel: string) => paged.doc.querySelectorAll(sel),
    } as unknown as Document;
    const messages = await collectPagedExchanges(noContainer, fast);
    expect(messages).toHaveLength(8);
  });

  it('falls back to a one-shot read when the container has zero height (background tab)', async () => {
    // A hidden tab never scrolls, so walking it would crawl to the step cap. The read returns
    // whatever is rendered rather than hanging.
    const paged = makePagedDoc({ total: 12, clientHeight: 0 });
    const messages = await collectPagedExchanges(paged.doc, fast);
    expect(messages).toHaveLength(20);
  });
});
