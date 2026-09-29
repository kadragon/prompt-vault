import { afterEach, describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import { chatgptAdapter } from '../../../src/adapters/chatgpt';
import { ExtractionError } from '../../../src/core/errors';

afterEach(() => vi.unstubAllGlobals());

interface LivePage {
  doc: Document;
  go: (pathname: string, body: string) => void;
}

/** A happy-dom page installed as the global `document`/`location` the openers read. */
function installLivePage(pathname: string, body: string): LivePage {
  const window = new Window();
  window.document.write(`<body>${body}</body>`);
  const loc = { origin: 'https://chatgpt.com', pathname, href: `https://chatgpt.com${pathname}` };
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('location', loc);
  const doc = window.document as unknown as Document;
  return {
    doc,
    go: (next, nextBody) => {
      loc.pathname = next;
      loc.href = `https://chatgpt.com${next}`;
      doc.body.innerHTML = nextBody;
    },
  };
}

const unit = (id: string): string => `<div data-chatgpt-search-message-ids="${id}"></div>`;
const PROJECT = '/g/g-p-6a7b0c';
const HOME_PATH = `${PROJECT}/project`;
const HOME_BODY =
  '<main><section><ol>' +
  `<li class="group/project-chat"><a href="${PROJECT}/c/conv-a"><div class="text-sm font-medium">A</div></a></li>` +
  `<li class="group/project-chat"><a href="${PROJECT}/c/conv-b"><div class="text-sm font-medium">B</div></a></li>` +
  '</ol></section></main>';
// An app-shell project conversation page: the header carries the back-to-project link, and
// nothing on the page links to the project's other conversations (measured 2026-09-29).
const conversationBody = (id: string): string =>
  `<header><a href="${PROJECT}-demo/project">Project</a></header><main>${unit(id)}</main>`;

/** Wire every project-list anchor and the header back link to navigate the fake page. */
function wireNavigation(page: LivePage): void {
  page.doc.addEventListener('click', (event) => {
    const href = (event.target as Element | null)?.closest?.('a')?.getAttribute('href');
    if (!href) return;
    if (href.endsWith('/project')) {
      page.go(HOME_PATH, HOME_BODY);
    } else {
      const id = href.split('/c/')[1];
      page.go(`${PROJECT}-demo/c/${id}`, conversationBody(id));
    }
  });
}

describe('chatgptAdapter.openProjectConversation', () => {
  it('opens a conversation listed on the project home page', async () => {
    const page = installLivePage(HOME_PATH, HOME_BODY);
    wireNavigation(page);
    await chatgptAdapter.openProjectConversation?.(`https://chatgpt.com${PROJECT}/c/conv-a`, {
      pollMs: 0,
      timeoutMs: 100,
    });
    expect(page.doc.querySelector('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids')).toBe('conv-a');
  });

  it('returns to the project home first when the open conversation page lists no project chats', async () => {
    // The app-shell conversation page has no project-conversation anchors at all (the
    // pre-app-shell sidebar expando is gone), so the second open of a bulk run used to fail.
    const page = installLivePage(`${PROJECT}-demo/c/conv-a`, conversationBody('conv-a'));
    wireNavigation(page);
    await chatgptAdapter.openProjectConversation?.(`https://chatgpt.com${PROJECT}/c/conv-b`, {
      pollMs: 0,
      timeoutMs: 100,
    });
    expect(page.doc.querySelector('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids')).toBe('conv-b');
  });

  it('fails loud when neither the page nor the project home lists the target', async () => {
    const page = installLivePage(`${PROJECT}-demo/c/conv-a`, conversationBody('conv-a'));
    wireNavigation(page);
    await expect(
      chatgptAdapter.openProjectConversation?.(`https://chatgpt.com${PROJECT}/c/conv-missing`, {
        pollMs: 0,
        timeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('never returns to a different project home than the target belongs to', async () => {
    // A conversation of ANOTHER project: its header links back to that project, not the target's.
    const page = installLivePage(
      '/g/g-p-0ff1ce-demo/c/conv-x',
      `<header><a href="/g/g-p-0ff1ce-demo/project">Other</a></header><main>${unit('conv-x')}</main>`,
    );
    let backClicks = 0;
    page.doc.addEventListener('click', () => backClicks++);
    await expect(
      chatgptAdapter.openProjectConversation?.(`https://chatgpt.com${PROJECT}/c/conv-b`, {
        pollMs: 0,
        timeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(ExtractionError);
    expect(backClicks).toBe(0);
  });
});

describe('chatgptAdapter.openConversation (app-shell sidebar)', () => {
  it('clicks the Recents row for the target and waits for its messages to swap in', async () => {
    const sidebar =
      '<nav><div data-sidebar-project-container-id="chats"><div role="list">' +
      '<div role="listitem" data-sidebar-chatgpt-conversation-key="chatgpt:conversation:conv-b">' +
      '<a href="/c/conv-b" data-interactive-row-link="" aria-label="B">B</a></div></div></div></nav>';
    const page = installLivePage('/c/conv-a', `${sidebar}<main>${unit('conv-a')}</main>`);
    page.doc.querySelector('a')?.addEventListener('click', () => page.go('/c/conv-b', `${sidebar}<main>${unit('conv-b')}</main>`));
    await chatgptAdapter.openConversation?.('https://chatgpt.com/c/conv-b', { pollMs: 0, timeoutMs: 100 });
    expect(page.doc.querySelector('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids')).toBe('conv-b');
  });
});
