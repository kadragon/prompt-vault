import { afterEach, describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import { claudeAdapter } from '../../../src/adapters/claude';
import { ExtractionError } from '../../../src/core/errors';

afterEach(() => vi.unstubAllGlobals());

const RECENTS_PATH = '/recents';

const RECENTS_TABLE =
  '<main><table data-cds="Table"><tbody><tr class="group/cdsrow"><td>' +
  '<a href="/chat/next" aria-label="Next">Next</a>' +
  '</td></tr></tbody></table></main>';

/**
 * A live `/recents` page with `history.back()` observable. The adapter reads history off the
 * document's own view, so the happy-dom window is the one that has to be intercepted — a bare
 * global stub would never be reached. Mirrors `installProjectPage` in ./navigation.test.ts.
 */
function installRecentsPage(
  html: string,
  pathname: string = RECENTS_PATH,
  withBack = true,
): {
  doc: Document;
  state: { pathname: string };
  backs: { count: number; onBack?: () => void };
} {
  const window = new Window({ url: `https://claude.ai${RECENTS_PATH}` });
  window.document.write(html);
  const state = { pathname };
  const backs: { count: number; onBack?: () => void } = { count: 0 };
  Object.defineProperty(window, 'history', {
    configurable: true,
    // `withBack: false` models a history object with no `back` — the shape the adapter checks
    // for before assuming it can navigate.
    value: withBack
      ? {
          back: () => {
            backs.count += 1;
            backs.onBack?.();
          },
        }
      : {},
  });
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('location', { origin: 'https://claude.ai', pathname: state.pathname });
  return { doc: window.document as unknown as Document, state, backs };
}

function setPathname(state: { pathname: string }, pathname: string): void {
  state.pathname = pathname;
  (globalThis.location as unknown as { pathname: string }).pathname = pathname;
}

describe('Claude /recents navigation openers', () => {
  it('clicks a verified recents anchor and waits for the target conversation to render', async () => {
    const { doc, state, backs } = installRecentsPage(
      `<body>${RECENTS_TABLE}</body>`,
    );
    doc.querySelector('a')?.addEventListener('click', () => {
      setPathname(state, '/chat/next');
      doc.body.innerHTML = '<div data-index="0"><div class="standard-markdown">next answer</div></div>';
    });

    await claudeAdapter.openRecentsConversation?.('https://claude.ai/chat/next', { pollMs: 0, timeoutMs: 100 });
    expect(state.pathname).toBe('/chat/next');
    expect(doc.querySelector('.standard-markdown')?.textContent).toBe('next answer');
    // Already ON `/recents`, so no navigation was owed: this pins `openRecentsConversation`'s
    // OUTER route gate, which skips the return entirely — `returnToRecents` is never entered
    // here. Its own no-op-while-already-there guard is pinned separately, by "waits out a
    // hydrating /recents instead of navigating away from it" below.
    expect(backs.count).toBe(0);
  });

  it('returns to /recents by route, not by the presence of a table', async () => {
    // An assistant markdown table also matches `main table`, so deciding on a rendered table
    // instead of the route would skip the return here — and then every remaining member of the
    // batch would fail, its anchor looked for inside the answer's table.
    const { doc, state, backs } = installRecentsPage(
      '<body><main><table><tbody><tr><td>a markdown table in the answer</td></tr></tbody></table></main>' +
        '<div data-index="0"><div class="standard-markdown">previous answer</div></div></body>',
      '/chat/previous',
    );
    backs.onBack = () => {
      setPathname(state, RECENTS_PATH);
      doc.body.innerHTML = RECENTS_TABLE;
      doc.querySelector('a')?.addEventListener('click', () => {
        setPathname(state, '/chat/next');
        doc.body.innerHTML = '<div data-index="0"><div class="standard-markdown">next answer</div></div>';
      });
    };

    await claudeAdapter.openRecentsConversation?.('https://claude.ai/chat/next', { pollMs: 1, timeoutMs: 200 });
    expect(backs.count).toBe(1);
    // Reaching the target proves the round trip re-resolved the restored table: the anchor only
    // exists in the markup `back()` brought back, never in the markdown table above.
    expect(state.pathname).toBe('/chat/next');
    expect(doc.querySelector('.standard-markdown')?.textContent).toBe('next answer');
  });

  it('reports an unreachable recents target instead of extracting the current chat', async () => {
    const { doc, state } = installRecentsPage(`<body>${RECENTS_TABLE}</body>`);
    await expect(
      claudeAdapter.openRecentsConversation?.('https://claude.ai/chat/missing', { pollMs: 0, timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ExtractionError);
    expect(state.pathname).toBe(RECENTS_PATH);
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('/chat/next');
  });

  it('fails loud when the browser exposes no history to go back through', async () => {
    // Off-route, so the return is owed — and without `back()` there is no way to reach the list.
    // Silently continuing would look for the anchor in whatever page is showing.
    installRecentsPage(
      '<body><div data-index="0"><div class="standard-markdown">previous answer</div></div></body>',
      '/chat/previous',
      false,
    );
    await expect(
      claudeAdapter.openRecentsConversation?.('https://claude.ai/chat/next', { pollMs: 1, timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('times out visibly when /recents never comes back', async () => {
    const { backs } = installRecentsPage(
      '<body><div data-index="0"><div class="standard-markdown">previous answer</div></div></body>',
      '/chat/previous',
    );
    await expect(
      claudeAdapter.openRecentsConversation?.('https://claude.ai/chat/next', { pollMs: 1, timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(ExtractionError);
    expect(backs.count).toBe(1);
  });

  it('waits out a hydrating /recents instead of navigating away from it', async () => {
    const { doc, state, backs } = installRecentsPage('<body><main>still hydrating</main></body>');
    setTimeout(() => {
      doc.body.innerHTML = RECENTS_TABLE;
    }, 5);

    await claudeAdapter.openRecentsHome?.('https://claude.ai/recents', { pollMs: 1, timeoutMs: 200 });
    expect(backs.count).toBe(0);
    expect(state.pathname).toBe(RECENTS_PATH);
  });

  it('refuses to treat a non-recents URL as the recents home', async () => {
    // `openRecentsHome` is the bulk driver's "return the user where they started" hook. Accepting
    // any URL would silently send a `/recents` run somewhere else.
    installRecentsPage(`<body>${RECENTS_TABLE}</body>`);
    await expect(claudeAdapter.openRecentsHome?.('https://claude.ai/project/project-1')).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });

  it('rejects malformed navigation URLs visibly', async () => {
    installRecentsPage(`<body>${RECENTS_TABLE}</body>`);
    await expect(claudeAdapter.openRecentsConversation?.('not a URL')).rejects.toBeInstanceOf(ExtractionError);
    await expect(claudeAdapter.openRecentsConversation?.('https://claude.ai/recents')).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });
});
