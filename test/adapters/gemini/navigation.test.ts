import { afterEach, describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import { geminiAdapter } from '../../../src/adapters/gemini';
import { ExtractionError } from '../../../src/core/errors';

afterEach(() => vi.unstubAllGlobals());

const TARGET = '0123456789abcdef';
const OTHER = 'fedcba9876543210';
const DEEP = 'abcdef0123456789';

function row(id: string, label: string): string {
  return `<gem-nav-list-item data-test-id="conversation"><a href="/app/${id}" aria-label="${label}">${label}</a></gem-nav-list-item>`;
}

function exchange(text: string, id = 'c_1'): string {
  return `<div class="conversation-container" id="${id}"><user-query>${text}</user-query></div>`;
}

function installLivePage(html: string, pathname: string): { doc: Document; state: { pathname: string } } {
  const window = new Window();
  window.document.write(html);
  const state = { pathname };
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('location', { origin: 'https://gemini.google.com', pathname: state.pathname });
  return { doc: window.document as unknown as Document, state };
}

function setPathname(state: { pathname: string }, pathname: string): void {
  state.pathname = pathname;
  (globalThis.location as unknown as { pathname: string }).pathname = pathname;
}

describe('geminiAdapter.openConversation', () => {
  it('clicks the verified sidebar anchor instead of assigning location, and waits for the target', async () => {
    // Gemini is an SPA: a `location =` assignment reloads the page, tearing down the content
    // script and whatever bulk run is in flight.
    const { doc, state } = installLivePage(
      `<body><infinite-scroller>${row(TARGET, 'Target')}</infinite-scroller>${exchange('old', 'c_old')}</body>`,
      '/app/' + OTHER,
    );
    let assigned = 0;
    Object.defineProperty(globalThis.location, 'href', {
      configurable: true,
      get: () => `https://gemini.google.com${state.pathname}`,
      set: () => {
        assigned++;
      },
    });
    doc.querySelector('a')?.addEventListener('click', () => {
      setPathname(state, `/app/${TARGET}`);
      doc.body.innerHTML = exchange('new target', 'c_new');
    });

    await geminiAdapter.openConversation?.(`https://gemini.google.com/app/${TARGET}`, { pollMs: 0, timeoutMs: 100 });
    expect(assigned).toBe(0);
    expect(state.pathname).toBe(`/app/${TARGET}`);
    expect(doc.querySelector('user-query')?.textContent).toBe('new target');
  });

  it('returns immediately when the target route is already rendered', async () => {
    const { doc } = installLivePage(
      `<body><infinite-scroller>${row(TARGET, 'Target')}</infinite-scroller>${exchange('already here')}</body>`,
      `/app/${TARGET}`,
    );
    let clicks = 0;
    doc.querySelector('a')?.addEventListener('click', () => {
      clicks++;
    });

    await geminiAdapter.openConversation?.(`https://gemini.google.com/app/${TARGET}`, { pollMs: 0, timeoutMs: 100 });
    expect(clicks).toBe(0);
  });

  it('scrolls the sidebar to reveal a target that has not paged in yet, then opens it', async () => {
    // The sidebar pages at 20 (2026-08-10), so on any account past the first page a selected
    // conversation is simply not in the DOM when the bulk driver asks for it.
    const { doc, state } = installLivePage(
      '<body><infinite-scroller><div id="port" style="overflow-y:auto">' +
        row(OTHER, 'Visible') +
        `</div></infinite-scroller>${exchange('old', 'c_old')}</body>`,
      `/app/${OTHER}`,
    );
    const port = doc.getElementById('port')!;
    let top = 0;
    let revealed = false;
    Object.defineProperties(port, {
      clientHeight: { configurable: true, value: 20 },
      scrollHeight: { configurable: true, value: 40 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = Math.min(value, 20);
          if (top >= 20 && !revealed) {
            revealed = true;
            port.insertAdjacentHTML('beforeend', row(DEEP, 'Deep'));
            port.querySelector(`a[href="/app/${DEEP}"]`)?.addEventListener('click', () => {
              setPathname(state, `/app/${DEEP}`);
              doc.body.innerHTML = exchange('deep target', 'c_deep');
            });
          }
        },
      },
    });

    await geminiAdapter.openConversation?.(`https://gemini.google.com/app/${DEEP}`, { pollMs: 1, timeoutMs: 200 });
    expect(revealed).toBe(true);
    expect(state.pathname).toBe(`/app/${DEEP}`);
    expect(doc.querySelector('user-query')?.textContent).toBe('deep target');
  });

  it('bounds the reveal walk by the caller’s timeout instead of the loader’s own step ceiling', async () => {
    // The reveal runs BEFORE the wait-for-render clock starts, so leaving it on the loader's
    // user-initiated "Load more" ceiling (400 steps) would let one missing anchor spend far
    // longer than the caller asked for — once per conversation across a bulk export.
    const { doc } = installLivePage(
      '<body><infinite-scroller><div id="port" style="overflow-y:auto">' +
        row(OTHER, 'Visible') +
        `</div></infinite-scroller>${exchange('current')}</body>`,
      `/app/${OTHER}`,
    );
    const port = doc.getElementById('port')!;
    let top = 0;
    let scrollWrites = 0;
    // A port that keeps growing never clamps, so only the step budget can end the walk.
    Object.defineProperties(port, {
      clientHeight: { configurable: true, value: 20 },
      scrollHeight: { configurable: true, get: () => 40 + scrollWrites * 20 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          scrollWrites++;
          top = value;
        },
      },
    });

    await expect(
      geminiAdapter.openConversation?.(`https://gemini.google.com/app/${DEEP}`, { pollMs: 1, timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ExtractionError);
    // timeoutMs / pollMs = 10 steps, far below the loader's 400-step default.
    expect(scrollWrites).toBeLessThanOrEqual(10);
  });

  it('reports an unreachable target instead of extracting the conversation still on screen', async () => {
    // The silent-wrong-file case: without this the bulk driver would export the OUTGOING
    // conversation under the missing one's name (AGENTS.md #4).
    installLivePage(
      `<body><infinite-scroller>${row(OTHER, 'Other')}</infinite-scroller>${exchange('current')}</body>`,
      `/app/${OTHER}`,
    );
    await expect(
      geminiAdapter.openConversation?.(`https://gemini.google.com/app/${TARGET}`, { pollMs: 0, timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('does not resolve on a stale render when the route flips before the exchange DOM swaps', async () => {
    // Gemini's router updates the URL first, so for a moment the route matches, exchanges are
    // rendered, and `messageSignature()` still describes the OUTGOING conversation. Accepting that
    // let `driveBulkPanel` extract the previous chat and save it under this conversation's name —
    // silent wrong output (AGENTS.md #4).
    //
    // Run at the PRODUCTION caller budget: `src/content/mount.ts:444` calls `openConversation(url)`
    // with no options, so the defaults (`pollMs` 150, `timeoutMs` 15000) are what ships. A test
    // that instead passed a short `timeoutMs` would pass against any guard whose acceptance point
    // merely sat past that budget — it would pin the harness, not the guard. Nothing is passed
    // here for the same reason.
    vi.useFakeTimers();
    try {
      const { doc, state } = installLivePage(
        `<body><infinite-scroller>${row(TARGET, 'Target')}</infinite-scroller>${exchange('outgoing', 'c_old')}</body>`,
        `/app/${OTHER}`,
      );
      const outgoing = doc.querySelector('.conversation-container');
      // The route flips; the exchange nodes are never replaced.
      doc.querySelector('a')?.addEventListener('click', () => setPathname(state, `/app/${TARGET}`));

      const settled = geminiAdapter.openConversation?.(`https://gemini.google.com/app/${TARGET}`);
      const rejection = expect(settled).rejects.toBeInstanceOf(ExtractionError);
      await vi.advanceTimersByTimeAsync(16000);
      await rejection;
      // The very same node object is still mounted — which is exactly what the guard read to
      // refuse, and what the caller must not have been handed.
      expect(doc.querySelector('.conversation-container')).toBe(outgoing);
      expect(doc.querySelector('user-query')?.textContent).toBe('outgoing');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves on the real swap however late it lands, at the production caller budget', async () => {
    // The same router ordering, made whole. 2.5 s is deliberately past the 1.5 s dwell an earlier
    // revision used: a swap slower than the dwell was resolved with the OUTGOING conversation,
    // which is the second half of why time was the wrong signal.
    vi.useFakeTimers();
    try {
      const { doc, state } = installLivePage(
        `<body><infinite-scroller>${row(TARGET, 'Target')}</infinite-scroller>${exchange('outgoing', 'c_old')}</body>`,
        `/app/${OTHER}`,
      );
      doc.querySelector('a')?.addEventListener('click', () => {
        setPathname(state, `/app/${TARGET}`);
        setTimeout(() => {
          doc.body.innerHTML = exchange('the target conversation', 'c_new');
        }, 2500);
      });

      const settled = geminiAdapter.openConversation?.(`https://gemini.google.com/app/${TARGET}`);
      await vi.advanceTimersByTimeAsync(4000);
      await settled;
      expect(doc.querySelector('user-query')?.textContent).toBe('the target conversation');
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a re-rendered target whose shape is indistinguishable from the outgoing one', async () => {
    // `messageSignature()` carries only the exchange ids, the count and two text LENGTHS, so two
    // same-shaped conversations produce the same string. Requiring it to CHANGE would stall until
    // the timeout and report a correctly loaded chat as skipped, so the unchanged-signature branch
    // has to exist — this pins that it does, and that a genuine re-render satisfies it.
    //
    // It does NOT pin the node-identity guard: neutralizing that guard only makes this branch more
    // permissive, so this test would stay green. The stale-render test above is the one that goes
    // red, and it is where that guard is pinned.
    vi.useFakeTimers();
    try {
      const { doc, state } = installLivePage(
        `<body><infinite-scroller>${row(TARGET, 'Twin')}</infinite-scroller>${exchange('aaa', 'c_1')}</body>`,
        `/app/${OTHER}`,
      );
      doc.querySelector('a')?.addEventListener('click', () => {
        setPathname(state, `/app/${TARGET}`);
        // A real re-render: new element objects carrying an identical fingerprint.
        doc.body.innerHTML = exchange('bbb', 'c_1');
      });

      const settled = geminiAdapter.openConversation?.(`https://gemini.google.com/app/${TARGET}`);
      await vi.advanceTimersByTimeAsync(4000);
      await settled;
      expect(state.pathname).toBe(`/app/${TARGET}`);
      expect(doc.querySelector('user-query')?.textContent).toBe('bbb');
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out visibly when the clicked target never renders', async () => {
    const { doc, state } = installLivePage(
      `<body><infinite-scroller>${row(TARGET, 'Target')}</infinite-scroller>${exchange('old', 'c_old')}</body>`,
      `/app/${OTHER}`,
    );
    // The route changes but the exchanges never do — a conversation stuck loading.
    doc.querySelector('a')?.addEventListener('click', () => {
      setPathname(state, `/app/${TARGET}`);
      doc.body.innerHTML = '<div>loading…</div>';
    });

    await expect(
      geminiAdapter.openConversation?.(`https://gemini.google.com/app/${TARGET}`, { pollMs: 1, timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('rejects a malformed or non-conversation URL visibly', async () => {
    installLivePage('<body></body>', '/app');
    await expect(geminiAdapter.openConversation?.('not a URL')).rejects.toBeInstanceOf(ExtractionError);
    await expect(geminiAdapter.openConversation?.('https://gemini.google.com/gems/view')).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });
});
