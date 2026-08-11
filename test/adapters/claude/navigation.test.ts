import { afterEach, describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import { claudeAdapter } from '../../../src/adapters/claude';
import { ExtractionError } from '../../../src/core/errors';

afterEach(() => vi.unstubAllGlobals());

function installLivePage(html: string, pathname: string): { doc: Document; state: { pathname: string } } {
  const window = new Window();
  window.document.write(html);
  const state = { pathname };
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('location', { origin: 'https://claude.ai', pathname: state.pathname });
  return { doc: window.document as unknown as Document, state };
}

const PROJECT_HOME_PATH = '/project/project-1';

/**
 * A live page whose project home is already cached, with `history.back()` observable. The
 * adapter reads history off the document's own view, so the happy-dom window is the one that
 * has to be intercepted — a global stub would never be reached.
 */
function installProjectPage(html: string): {
  doc: Document;
  state: { pathname: string };
  backs: { count: number; onBack?: () => void };
} {
  const home = new Window({ url: `https://claude.ai${PROJECT_HOME_PATH}` });
  home.document.write(
    '<body><main><table data-cds="Table"><tbody><tr><td><a href="/chat/next" aria-label="Next">Next</a></td></tr></tbody></table></main></body>',
  );
  // Caches the measured project-home URL the openers return to.
  claudeAdapter.listProjectConversations?.(home.document as unknown as Document);

  const window = new Window({ url: `https://claude.ai${PROJECT_HOME_PATH}` });
  window.document.write(html);
  const state = { pathname: PROJECT_HOME_PATH };
  const backs: { count: number; onBack?: () => void } = { count: 0 };
  Object.defineProperty(window, 'history', {
    configurable: true,
    value: {
      back: () => {
        backs.count += 1;
        backs.onBack?.();
      },
    },
  });
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('location', { origin: 'https://claude.ai', pathname: state.pathname });
  return { doc: window.document as unknown as Document, state, backs };
}

function setPathname(state: { pathname: string }, pathname: string): void {
  state.pathname = pathname;
  (globalThis.location as unknown as { pathname: string }).pathname = pathname;
}

describe('Claude navigation openers', () => {
  it('clicks a verified sidebar anchor and waits for the target conversation to render', async () => {
    const { doc, state } = installLivePage(
      '<body><aside aria-label="사이드바"><a href="/chat/target" aria-label="Target">Target</a></aside>' +
        '<div data-index="0"><div class="standard-markdown">old</div></div></body>',
      '/chat/old',
    );
    doc.querySelector('a')?.addEventListener('click', () => {
      setPathname(state, '/chat/target');
      doc.body.innerHTML = '<div data-index="0"><div class="standard-markdown">new target</div></div>';
    });

    await claudeAdapter.openConversation?.('https://claude.ai/chat/target', { pollMs: 0, timeoutMs: 100 });
    expect(state.pathname).toBe('/chat/target');
    expect(doc.querySelector('.standard-markdown')?.textContent).toBe('new target');
  });

  it('scrolls the sidebar to reveal a target that is not rendered yet, then opens it', async () => {
    // `findSidebarAnchor` only ever sees rendered anchors. The 2026-08-09 measurement (20 links,
    // no recycling) makes that safe for today's sidebar but proves nothing about a longer one,
    // so a target below the fold must be materialized rather than reported as missing.
    const { doc, state } = installLivePage(
      '<body><aside aria-label="사이드바"><div id="recent" style="overflow-y:auto">' +
        '<a href="/chat/visible" aria-label="Visible">Visible</a></div></aside>' +
        '<div data-index="0"><div class="standard-markdown">old</div></div></body>',
      '/chat/old',
    );
    const port = doc.getElementById('recent')!;
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
          // The virtualized port renders the deeper row only once it is scrolled into view.
          if (top >= 20 && !revealed) {
            revealed = true;
            port.insertAdjacentHTML('beforeend', '<a href="/chat/deep" aria-label="Deep">Deep</a>');
            port.querySelector('a[href="/chat/deep"]')?.addEventListener('click', () => {
              setPathname(state, '/chat/deep');
              doc.body.innerHTML = '<div data-index="0"><div class="standard-markdown">deep target</div></div>';
            });
          }
        },
      },
    });

    await claudeAdapter.openConversation?.('https://claude.ai/chat/deep', { pollMs: 0, timeoutMs: 200 });
    expect(revealed).toBe(true);
    expect(state.pathname).toBe('/chat/deep');
    expect(doc.querySelector('.standard-markdown')?.textContent).toBe('deep target');
  });

  it('bounds the reveal walk by the caller’s timeout instead of the loader’s own step ceiling', async () => {
    // The reveal runs BEFORE `waitForOpenedConversation` starts its clock, so leaving it on the
    // loader's user-initiated "Load more" ceiling (400 steps) would let one missing anchor spend
    // far longer than the caller asked for — once per conversation across a bulk export.
    const { doc } = installLivePage(
      '<body><aside aria-label="사이드바"><div id="recent" style="overflow-y:auto">' +
        '<a href="/chat/visible" aria-label="Visible">Visible</a></div></aside>' +
        '<div data-index="0"><div class="standard-markdown">current</div></div></body>',
      '/chat/current',
    );
    const port = doc.getElementById('recent')!;
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
      claudeAdapter.openConversation?.('https://claude.ai/chat/missing', { pollMs: 1, timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ExtractionError);
    // timeoutMs / pollMs = 10 steps. Far below the loader's 400-step default, which is the
    // ceiling this test exists to keep the reveal walk off.
    expect(scrollWrites).toBeLessThanOrEqual(10);
  });

  it('reports an unreachable sidebar target instead of extracting the current chat', async () => {
    installLivePage(
      '<body><aside aria-label="사이드바"><a href="/chat/other" aria-label="Other">Other</a></aside>' +
        '<div data-index="0"><div class="standard-markdown">current</div></div></body>',
      '/chat/current',
    );
    await expect(
      claudeAdapter.openConversation?.('https://claude.ai/chat/missing', { pollMs: 0, timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('waits for a project target to render after clicking its measured table anchor', async () => {
    const { doc, state } = installLivePage(
      '<body><main><table data-cds="Table"><tbody><tr><td><a href="/chat/project-target">Project target</a></td></tr></tbody></table></main>' +
        '<div data-index="0"><div class="standard-markdown">old</div></div></body>',
      '/project/project-1',
    );
    doc.querySelector('a')?.addEventListener('click', () => {
      setPathname(state, '/chat/project-target');
      doc.body.innerHTML = '<div data-index="0"><div class="standard-markdown">project target</div></div>';
    });

    await claudeAdapter.openProjectConversation?.('https://claude.ai/chat/project-target', {
      pollMs: 0,
      timeoutMs: 100,
    });
    expect(state.pathname).toBe('/chat/project-target');
    expect(doc.querySelector('.standard-markdown')?.textContent).toBe('project target');
  });

  it('accepts a target whose rendered shape is indistinguishable from the outgoing one', async () => {
    // `messageSignature()` carries only row indices, turn count and two text LENGTHS, so two
    // same-shaped conversations produce the same string. Waiting for it to CHANGE would stall
    // until the timeout and report a correctly loaded chat as skipped.
    const { doc, state } = installLivePage(
      '<body><aside aria-label="Sidebar"><a href="/chat/twin" aria-label="Twin">Twin</a></aside>' +
        '<div data-index="0"><div class="standard-markdown">aaa</div></div></body>',
      '/chat/old',
    );
    doc.querySelector('a')?.addEventListener('click', () => {
      setPathname(state, '/chat/twin');
      doc.body.innerHTML = '<div data-index="0"><div class="standard-markdown">bbb</div></div>';
    });

    await claudeAdapter.openConversation?.('https://claude.ai/chat/twin', { pollMs: 0, timeoutMs: 100 });
    expect(state.pathname).toBe('/chat/twin');
    expect(doc.querySelector('.standard-markdown')?.textContent).toBe('bbb');
  });

  it('returns to the project home by route, not by the presence of a table', async () => {
    // An assistant markdown table also matches `main table`, so a chat page that renders one
    // must still count as "left the project home" and trigger the return.
    const { doc, state, backs } = installProjectPage(
      '<body><main><table><tbody><tr><td>a markdown table in the answer</td></tr></tbody></table></main>' +
        '<div data-index="0"><div class="standard-markdown">previous answer</div></div></body>',
    );
    setPathname(state, '/chat/previous');
    backs.onBack = () => {
      setPathname(state, '/project/project-1');
      doc.body.innerHTML =
        '<main><table data-cds="Table"><tbody><tr><td><a href="/chat/next" aria-label="Next">Next</a></td></tr></tbody></table></main>';
      doc.querySelector('a')?.addEventListener('click', () => {
        setPathname(state, '/chat/next');
        doc.body.innerHTML = '<div data-index="0"><div class="standard-markdown">next answer</div></div>';
      });
    };

    await claudeAdapter.openProjectConversation?.('https://claude.ai/chat/next', { pollMs: 1, timeoutMs: 200 });
    expect(backs.count).toBe(1);
    expect(state.pathname).toBe('/chat/next');
  });

  // The project twin of the `/recents` rewind cases (test/adapters/claude/recents-navigation.test.ts):
  // an open that pushed two history entries leaves the home one step further back than a single
  // `back()` reaches. Fake timers, because the retry interval is the real multi-second one.
  it('rewinds a second entry when one back() lands short of the project home', async () => {
    vi.useFakeTimers();
    try {
      const { doc, state, backs } = installProjectPage(
        '<body><div data-index="0"><div class="standard-markdown">previous answer</div></div></body>',
      );
      setPathname(state, '/chat/previous');
      backs.onBack = () => {
        if (backs.count < 2) {
          setPathname(state, '/chat/previous-rewritten');
          return;
        }
        setPathname(state, PROJECT_HOME_PATH);
        doc.body.innerHTML =
          '<main><table data-cds="Table"><tbody><tr><td><a href="/chat/next" aria-label="Next">Next</a></td></tr></tbody></table></main>';
      };

      const settled = claudeAdapter.openProjectHome?.(`https://claude.ai${PROJECT_HOME_PATH}`, {
        pollMs: 100,
        timeoutMs: 15000,
      });
      await vi.advanceTimersByTimeAsync(5000);

      await settled;
      expect(state.pathname).toBe(PROJECT_HOME_PATH);
      expect(backs.count).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps the rewind and still times out visibly when the project home is unreachable', async () => {
    vi.useFakeTimers();
    try {
      const { state, backs } = installProjectPage(
        '<body><div data-index="0"><div class="standard-markdown">previous answer</div></div></body>',
      );
      setPathname(state, '/chat/previous');

      const settled = claudeAdapter.openProjectHome?.(`https://claude.ai${PROJECT_HOME_PATH}`, {
        pollMs: 100,
        timeoutMs: 15000,
      });
      const rejection = expect(settled).rejects.toBeInstanceOf(ExtractionError);
      await vi.advanceTimersByTimeAsync(16000);
      await rejection;

      expect(backs.count).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops rewinding once back() has landed on the project home, however slowly its table hydrates', async () => {
    // Twin of the `/recents` case: the retry is for a `back()` that landed SHORT of the home.
    // Once the home route is reached, a slow table only needs waiting out — rewinding again
    // walks the user's own history and turns a slow success into a timeout.
    vi.useFakeTimers();
    try {
      const { doc, state, backs } = installProjectPage(
        '<body><div data-index="0"><div class="standard-markdown">previous answer</div></div></body>',
      );
      setPathname(state, '/chat/previous');
      backs.onBack = () => {
        if (backs.count > 1) {
          setPathname(state, '/chat/user-earlier');
          doc.body.innerHTML = '<main>someone else’s page</main>';
          return;
        }
        setPathname(state, PROJECT_HOME_PATH);
        doc.body.innerHTML = '<main>still hydrating</main>';
      };

      const settled = claudeAdapter.openProjectHome?.(`https://claude.ai${PROJECT_HOME_PATH}`, {
        pollMs: 100,
        timeoutMs: 15000,
      });
      setTimeout(() => {
        doc.body.innerHTML =
          '<main><table data-cds="Table"><tbody><tr><td><a href="/chat/next" aria-label="Next">Next</a></td></tr></tbody></table></main>';
      }, 8000);
      await vi.advanceTimersByTimeAsync(9000);

      await settled;
      expect(backs.count).toBe(1);
      expect(state.pathname).toBe(PROJECT_HOME_PATH);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits out a hydrating project home instead of navigating away from it', async () => {
    // Already on the home route: firing `back()` here pops to the previous `/chat/<id>` entry
    // and the wait below would then poll for a home the call itself just abandoned.
    const { doc, state, backs } = installProjectPage('<body><main>still hydrating</main></body>');
    setTimeout(() => {
      doc.body.innerHTML =
        '<main><table data-cds="Table"><tbody><tr><td><a href="/chat/aaa" aria-label="First">First</a></td></tr></tbody></table></main>';
    }, 5);

    await claudeAdapter.openProjectHome?.('https://claude.ai/project/project-1', { pollMs: 1, timeoutMs: 200 });
    expect(backs.count).toBe(0);
    expect(state.pathname).toBe('/project/project-1');
  });

  it('rejects malformed navigation URLs visibly', async () => {
    installLivePage('<body></body>', '/project/project-1');
    await expect(claudeAdapter.openConversation?.('not a URL')).rejects.toBeInstanceOf(ExtractionError);
    await expect(claudeAdapter.openProjectConversation?.('https://claude.ai/project/project-1')).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });
});
