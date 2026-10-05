import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { chatgptAdapter } from '../../../src/adapters/chatgpt';
import { selectors } from '../../../src/adapters/chatgpt/selectors';

function docFrom(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

// The app-shell left sidebar, captured live 2026-09-29 and sanitized: a Projects section,
// then the Recents section holding three conversation rows and its trailing loading row.
const SIDEBAR = readFileSync(fileURLToPath(new URL('../../fixtures/chatgpt/sidebar.html', import.meta.url)), 'utf8');
// The same sidebar after a Recents page fetch answered 429 (measured 2026-10-03): no loading row,
// and an error status with a retry button rendered as the list's next sibling.
const SIDEBAR_ERROR = readFileSync(
  fileURLToPath(new URL('../../fixtures/chatgpt/sidebar-error.html', import.meta.url)),
  'utf8',
);

/** The fixture with extra markup appended inside the Recents list or the page body. */
function sidebarWith({ recentsRow = '', outside = '' }: { recentsRow?: string; outside?: string }): Document {
  const doc = docFrom(SIDEBAR);
  const list = doc.querySelector('[data-sidebar-project-container-id="chats"] [role="list"]');
  if (recentsRow) list?.insertAdjacentHTML('afterbegin', recentsRow);
  if (outside) doc.querySelector('main')?.insertAdjacentHTML('beforeend', outside);
  return doc;
}

describe('chatgptAdapter.listConversations', () => {
  it('enumerates the Recents rows of the captured sidebar in order, titled by aria-label', () => {
    const list = chatgptAdapter.listConversations?.(docFrom(SIDEBAR)) ?? [];
    expect(list.map((c) => c.id)).toEqual(['conv-aaa', 'conv-bbb', 'conv-ccc']);
    expect(list[0].url).toBe('https://chatgpt.com/c/conv-aaa');
    // The fixture's labels are synthetic ("Label N"); the title is the untruncated aria-label.
    expect(list.every((c) => /^Label \d+$/.test(c.title))).toBe(true);
  });

  it('dedupes by conversation id so a query-carrying link to the same chat is not listed twice', () => {
    const doc = sidebarWith({
      recentsRow:
        '<div role="listitem" data-sidebar-chatgpt-conversation-key="chatgpt:conversation:conv-aaa">' +
        '<a href="/c/conv-aaa?messageId=x" data-interactive-row-link="" aria-label="Dup">Dup</a></div>',
    });
    const list = chatgptAdapter.listConversations?.(doc) ?? [];
    expect(list.filter((c) => c.id === 'conv-aaa')).toHaveLength(1);
    expect(list.find((c) => c.id === 'conv-aaa')?.url).toBe('https://chatgpt.com/c/conv-aaa');
  });

  it('excludes /c/ links outside the Recents list (page body, project chats)', () => {
    const doc = sidebarWith({
      outside: '<a href="/c/stray" aria-label="Stray">Stray</a><a href="/g/g-p-proj1/c/proj" aria-label="P">P</a>',
    });
    const ids = (chatgptAdapter.listConversations?.(doc) ?? []).map((c) => c.id);
    expect(ids).not.toContain('stray');
    expect(ids).not.toContain('proj');
  });

  it('finds the captured loading row inside the Recents list — the "page still owed" signal', () => {
    const history = docFrom(SIDEBAR).querySelector(selectors.sidebarHistory);
    expect(history?.querySelector(selectors.sidebarLoadingStatus)).not.toBeNull();
  });

  it('never reads a status inside a conversation row as the loading row', () => {
    const doc = docFrom(
      '<body><div data-sidebar-project-container-id="chats"><div role="list">' +
        '<div role="listitem" data-sidebar-chatgpt-conversation-key="chatgpt:conversation:x">' +
        '<a href="/c/x" aria-label="X">X</a><span role="status">generating</span></div></div></div></body>',
    );
    expect(doc.querySelector(selectors.sidebarHistory)?.querySelector(selectors.sidebarLoadingStatus)).toBeNull();
  });

  it('finds the retry button of the load-error status the page shows after a 429', () => {
    const history = docFrom(SIDEBAR_ERROR).querySelector(selectors.sidebarHistory);
    expect(history?.querySelector(selectors.sidebarListRetry)?.tagName).toBe('BUTTON');
    // The measured error state carries no loading row: that signal alone would read as an end.
    expect(history?.querySelector(selectors.sidebarLoadingStatus)).toBeNull();
  });

  it('finds no retry button on the healthy captured sidebar or inside a conversation row', () => {
    expect(docFrom(SIDEBAR).querySelector(selectors.sidebarHistory)?.querySelector(selectors.sidebarListRetry)).toBeNull();
    const doc = docFrom(
      '<body><div data-sidebar-project-container-id="chats"><div role="list">' +
        '<div role="listitem" data-sidebar-chatgpt-conversation-key="chatgpt:conversation:x">' +
        '<a href="/c/x" aria-label="X">X</a><div role="status"><button>B</button></div></div></div></div></body>',
    );
    expect(doc.querySelector(selectors.sidebarHistory)?.querySelector(selectors.sidebarListRetry)).toBeNull();
  });

  it('does not treat a busy sibling status button as the retry control', () => {
    const doc = docFrom(SIDEBAR_ERROR);
    const history = doc.querySelector(selectors.sidebarHistory);
    const status = history?.querySelector('[role="list"] + [role="status"]');
    expect(status).not.toBeNull();
    status?.setAttribute('aria-busy', 'true');
    expect(history?.querySelector(selectors.sidebarListRetry)).toBeNull();
  });

  it('lists the rows of the error-state sidebar like the healthy one', () => {
    const list = chatgptAdapter.listConversations?.(docFrom(SIDEBAR_ERROR)) ?? [];
    expect(list.map((c) => c.id)).toEqual(['conv-aaa', 'conv-bbb', 'conv-ccc']);
  });

  it('returns an empty list when the Recents list is absent', () => {
    const list = chatgptAdapter.listConversations?.(docFrom('<body><main>no sidebar</main></body>')) ?? [];
    expect(list).toEqual([]);
  });

  it('falls back to a generic title when a link has no aria-label or text', () => {
    const doc = docFrom('<body><div data-sidebar-project-container-id="chats"><a href="/c/eee"></a></div></body>');
    const list = chatgptAdapter.listConversations?.(doc) ?? [];
    expect(list).toEqual([{ id: 'eee', title: 'ChatGPT conversation', url: 'https://chatgpt.com/c/eee' }]);
  });
});
