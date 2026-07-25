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
// Three details make this a real test rather than a rubber stamp:
//   - the older batch is PREPENDED, and by default `scrollTop` is bumped by the prepended height,
//     the way a browser preserves visual position when content is inserted above. So a walk cannot
//     reach the true top in one jump: it must keep climbing as the list grows underneath it.
//   - the batch arrives only when the walk is already at `scrollTop <= 0` — the exact moment a
//     "am I at the top?" termination check would fire.
//   - `batchDelayRounds` holds it in flight for several rounds, and `batchLandingShiftsViewport`
//     switches between the two things a browser may do on arrival. Which one Gemini produces was
//     never measured, and the two shapes are what distinguish the two separate guards: the
//     shifting one the travel budget, the non-shifting one the settle condition.
// All three are why `docs/conventions.md` bans a jump-to-end fake: it would hide the bug entirely.

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
  /**
   * Whether a landing batch shifts the viewport down by the prepended height — what a browser
   * preserving visual position does, and the default. Set false to model the other outcome: the
   * list grows while `scrollTop` stays 0 (scroll anchoring off, or a virtualizer managing its own
   * spacer). Which one Gemini produces was never measured, and the two exercise different guards:
   * the shifting shape charges the travel budget, the non-shifting one is the only thing the
   * settle condition's "still changing?" term can be distinguished by.
   */
  batchLandingShiftsViewport?: boolean;
}

interface PagedDoc {
  doc: Document;
  container: HTMLElement;
  /** Exchanges rendered right now — the sanity check that the fake really does withhold. */
  rendered: () => number;
  /** Distinct scroll positions the walk wrote, so a test can assert it never scrolled at all. */
  scrollWrites: () => number;
}

function makePagedDoc({
  total,
  pageSize = 10,
  clientHeight = 836,
  stuck = false,
  trimTo,
  streamingLast = false,
  batchDelayRounds = 0,
  batchLandingShiftsViewport = true,
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
    // Nothing moves while the batch is in flight — that is the state the settle condition has to
    // survive. Its ARRIVAL either shifts the viewport down by the prepended height (a browser
    // preserving visual position — the default, and what makes the travel budget testable) or
    // leaves `scrollTop` at 0 (see `batchLandingShiftsViewport`).
    if (batchLandingShiftsViewport) top = batch * EXCHANGE_H;
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

  let scrollWrites = 0;

  Object.defineProperty(scroller, 'clientHeight', { get: () => clientHeight });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => scrollHeight() });
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      scrollWrites++;
      if (stuck) return;
      let next = Math.max(0, Math.min(v, Math.max(0, scrollHeight() - clientHeight)));
      if (next <= 0 && !trimmed) {
        if (from > 0) {
          // Reaching the top of the loaded range pages in the next batch of older exchanges.
          if (batchDelayRounds > 0) {
            // In flight: nothing changes for `batchDelayRounds` rounds; `landBatch` decides
            // whether the arrival shifts the viewport.
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
    scrollWrites: () => scrollWrites,
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
    const paged = makePagedDoc({ total: 36, batchDelayRounds: 3, batchLandingShiftsViewport: false });
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
      /of 16 loaded exchanges are still on the page/,
    );
  });

  it('fails loud when a response is still generating, instead of exporting a fragment', async () => {
    const paged = makePagedDoc({ total: 12, streamingLast: true });
    await expect(collectPagedExchanges(paged.doc, fast)).rejects.toThrow(/still generating/);
  });

  // The streaming check has to run BEFORE the walk, not only on the final read: the walk takes
  // seconds to minutes on a long conversation with every export button disabled, so discovering
  // "wait for the response to finish" afterwards wastes all of it. Asserting zero scroll writes
  // is what distinguishes the two call sites — a post-walk-only check passes the message test
  // but scrolls the whole conversation first.
  it('rejects a still-generating page without scrolling at all', async () => {
    const paged = makePagedDoc({ total: 30, streamingLast: true });
    await expect(collectPagedExchanges(paged.doc, fast)).rejects.toThrow(/still generating/);
    expect(paged.scrollWrites()).toBe(0);
  });

  // Waiting for a batch must not be charged to the travel budget. With nine batches to page in
  // and every one of them stalling, the earlier distance-derived cap ran out of its fixed ~13
  // spare rounds and reported "timed out" on a page where nothing was wrong.
  it('exports a long conversation whose every batch stalls before landing', async () => {
    // Six batches, each stalling three rounds, on top of the full climb: ~70 travel rounds plus
    // ~18 waiting ones. Charging the waits to the distance-derived cap (~82) leaves the walk
    // short and it reports "timed out" with nothing actually wrong.
    const paged = makePagedDoc({ total: 60, batchDelayRounds: 3 });
    const messages = await collectPagedExchanges(paged.doc, fast);
    expect(messages).toHaveLength(120);
    expect(paged.rendered()).toBe(60);
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

  // Restoring the raw offset is wrong here, and the fake is what shows it: paging inserts older
  // exchanges ABOVE the reader, so `scrollHeight` grows and the message that was at offset X ends
  // up at X + everything-prepended. Writing X back would drop the user thousands of pixels
  // earlier in the conversation. Distance from the bottom is what stays put.
  it('puts the user back at the message they were reading, not the offset they were at', async () => {
    const paged = makePagedDoc({ total: 16 });
    const beforeTop = paged.container.scrollTop;
    const beforeHeight = paged.container.scrollHeight;
    const beforeFromBottom = beforeHeight - beforeTop;
    expect(beforeTop).toBeGreaterThan(0);

    await collectPagedExchanges(paged.doc, fast);

    // The list really did grow, so the two notions of "where they were" genuinely differ.
    expect(paged.container.scrollHeight).toBeGreaterThan(beforeHeight);
    expect(paged.container.scrollHeight - paged.container.scrollTop).toBe(beforeFromBottom);
    expect(paged.container.scrollTop).not.toBe(beforeTop);
  });

  it('restores the reading position on the failure path too', async () => {
    const failing = makePagedDoc({ total: 16, stuck: true });
    const beforeTop = failing.container.scrollTop;
    await expect(collectPagedExchanges(failing.doc, fast)).rejects.toBeInstanceOf(ExtractionError);
    // A stuck container never grew, so here the offset and the distance-from-bottom agree.
    expect(failing.container.scrollTop).toBe(beforeTop);
  });

  // An unwalkable list cannot page in what Gemini withheld, and Gemini declares no total, so
  // nothing downstream could detect the shortfall — the one path where a partial export would be
  // silent. It is allowed only when the page provably holds everything.
  it('reads a short conversation when the scroll container is missing', async () => {
    // Fewer than a full page rendered ⇒ nothing was withheld, because a load renders
    // min(pageSize, total).
    const paged = makePagedDoc({ total: 4, pageSize: 4 });
    const noContainer = {
      querySelector: () => null,
      querySelectorAll: (sel: string) => paged.doc.querySelectorAll(sel),
    } as unknown as Document;
    const messages = await collectPagedExchanges(noContainer, fast);
    expect(messages).toHaveLength(8);
  });

  it('fails loud when the scroll container is missing and a full page is rendered', async () => {
    const paged = makePagedDoc({ total: 40 });
    const noContainer = {
      querySelector: () => null,
      querySelectorAll: (sel: string) => paged.doc.querySelectorAll(sel),
    } as unknown as Document;
    await expect(collectPagedExchanges(noContainer, fast)).rejects.toThrow(
      /Could not find Gemini’s message list/,
    );
  });

  it('fails loud when the container cannot be scrolled and a full page is rendered', async () => {
    // clientHeight 0 — a hidden ancestor or a mid-route transition. Ten of 12 exchanges are
    // rendered and the other two can never be reached, so exporting would be a silent partial.
    const paged = makePagedDoc({ total: 12, clientHeight: 0 });
    await expect(collectPagedExchanges(paged.doc, fast)).rejects.toThrow(
      /cannot be scrolled right now/,
    );
  });

  it('reads a short conversation even when the container cannot be scrolled', async () => {
    const paged = makePagedDoc({ total: 3, clientHeight: 0 });
    const messages = await collectPagedExchanges(paged.doc, fast);
    expect(messages).toHaveLength(6);
  });
});
