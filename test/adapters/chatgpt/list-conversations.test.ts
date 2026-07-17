import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { chatgptAdapter } from '../../../src/adapters/chatgpt';

function docFrom(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

// A sidebar with two real conversations, a duplicate link to the first (the active
// chat's link carries a `?messageId=…` query), plus a project chat and a stray `/c/`
// link OUTSIDE #history — both of which must be excluded.
const SIDEBAR = `
  <body>
    <nav aria-label="Chat history">
      <div id="history">
        <ul>
          <li><a href="/c/aaa" aria-label="First chat">First chat</a></li>
          <li><a href="/c/bbb" aria-label="Second chat">Second…</a></li>
          <li><a href="/c/aaa?messageId=finalAgentTurnStart" aria-label="First chat">First chat</a></li>
        </ul>
      </div>
    </nav>
    <a href="/g/g-xyz/c/ccc" aria-label="Project chat">Project</a>
    <a href="/c/ddd" aria-label="Outside history">Outside</a>
  </body>`;

describe('chatgptAdapter.listConversations', () => {
  it('enumerates history conversations in order, using the full aria-label title', () => {
    const list = chatgptAdapter.listConversations?.(docFrom(SIDEBAR)) ?? [];
    expect(list).toEqual([
      { id: 'aaa', title: 'First chat', url: 'https://chatgpt.com/c/aaa' },
      { id: 'bbb', title: 'Second chat', url: 'https://chatgpt.com/c/bbb' },
    ]);
  });

  it('dedupes by conversation id so the active chat is not listed twice', () => {
    const list = chatgptAdapter.listConversations?.(docFrom(SIDEBAR)) ?? [];
    expect(list.filter((c) => c.id === 'aaa')).toHaveLength(1);
    // The query-carrying duplicate link does not leak the query into the opened URL.
    expect(list.find((c) => c.id === 'aaa')?.url).toBe('https://chatgpt.com/c/aaa');
  });

  it('excludes project/GPT chats and any /c/ links outside the history list', () => {
    const list = chatgptAdapter.listConversations?.(docFrom(SIDEBAR)) ?? [];
    const ids = list.map((c) => c.id);
    expect(ids).not.toContain('ccc'); // project chat (/g/…/c/…)
    expect(ids).not.toContain('ddd'); // stray link outside #history
  });

  it('returns an empty list when the history sidebar is absent', () => {
    const list = chatgptAdapter.listConversations?.(docFrom('<body><main>no sidebar</main></body>')) ?? [];
    expect(list).toEqual([]);
  });

  it('falls back to a generic title when a link has no aria-label or text', () => {
    const doc = docFrom('<body><div id="history"><a href="/c/eee"></a></div></body>');
    const list = chatgptAdapter.listConversations?.(doc) ?? [];
    expect(list).toEqual([{ id: 'eee', title: 'ChatGPT conversation', url: 'https://chatgpt.com/c/eee' }]);
  });
});
