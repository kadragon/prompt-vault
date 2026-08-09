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
      '<body><main><table><tbody><tr><td><a href="/chat/project-target">Project target</a></td></tr></tbody></table></main>' +
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

  it('rejects malformed navigation URLs visibly', async () => {
    installLivePage('<body></body>', '/project/project-1');
    await expect(claudeAdapter.openConversation?.('not a URL')).rejects.toBeInstanceOf(ExtractionError);
    await expect(claudeAdapter.openProjectConversation?.('https://claude.ai/project/project-1')).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });
});
