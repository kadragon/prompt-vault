import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { claudeAdapter } from '../../../src/adapters/claude';
import { ExtractionError } from '../../../src/core/errors';

function docFrom(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

const SIDEBAR = `
  <body>
    <aside aria-label="사이드바">
      <nav>
        <a href="/chat/aaa" aria-label="First Claude chat">First Claude chat</a>
        <a href="/chat/bbb" aria-label="Second Claude chat">Second Claude chat</a>
        <a href="/chat/aaa?messageId=latest" aria-label="First Claude chat">First Claude chat</a>
      </nav>
    </aside>
    <main><a href="/chat/outside" aria-label="Outside sidebar">Outside</a></main>
  </body>`;

describe('claudeAdapter.listConversations', () => {
  it('enumerates measured sidebar anchors in order with canonical URLs', () => {
    const list = claudeAdapter.listConversations?.(docFrom(SIDEBAR)) ?? [];
    expect(list).toEqual([
      { id: 'aaa', title: 'First Claude chat', url: 'https://claude.ai/chat/aaa' },
      { id: 'bbb', title: 'Second Claude chat', url: 'https://claude.ai/chat/bbb' },
    ]);
  });

  it('dedupes repeated anchors by the stable chat id and excludes links outside the sidebar', () => {
    const list = claudeAdapter.listConversations?.(docFrom(SIDEBAR)) ?? [];
    expect(list.filter((conversation) => conversation.id === 'aaa')).toHaveLength(1);
    expect(list.map((conversation) => conversation.id)).not.toContain('outside');
  });

  // A missing sidebar and an empty one render the SAME bulk-panel empty state, so the adapter
  // is the only place the two can be told apart. Returning `[]` for a dead selector reads to
  // the user as "this account has no conversations" (AGENTS.md #4).
  it('fails loud when the measured sidebar element is absent entirely', () => {
    const doc = docFrom('<body><main>not ready</main></body>');
    expect(() => claudeAdapter.listConversations?.(doc)).toThrow(ExtractionError);
  });

  it('returns an empty list when the sidebar rendered but holds no conversations', () => {
    const doc = docFrom('<body><aside aria-label="사이드바"><nav></nav></aside></body>');
    expect(claudeAdapter.listConversations?.(doc)).toEqual([]);
  });

  // One odd anchor must not cost the user every other conversation. Both shapes named in the
  // PR #58 review are covered: an icon-only link with no accessible name, and a nested
  // `/chat/<id>/share` path.
  it('skips an unusable anchor and still returns the readable ones', () => {
    const doc = docFrom(`
      <body>
        <aside aria-label="사이드바">
          <a href="/chat/aaa" aria-label="First Claude chat">First Claude chat</a>
          <a href="/chat/bbb/share" aria-label="Shared link">Shared link</a>
          <a href="/chat/ccc"></a>
          <a href="/chat/ddd" aria-label="Last Claude chat">Last Claude chat</a>
        </aside>
      </body>`);
    expect(claudeAdapter.listConversations?.(doc)).toEqual([
      { id: 'aaa', title: 'First Claude chat', url: 'https://claude.ai/chat/aaa' },
      { id: 'ddd', title: 'Last Claude chat', url: 'https://claude.ai/chat/ddd' },
    ]);
  });

  it('fails loud when a measured sidebar anchor has no title', () => {
    const doc = docFrom('<body><aside aria-label="사이드바"><a href="/chat/aaa"></a></aside></body>');
    expect(() => claudeAdapter.listConversations?.(doc)).toThrow(ExtractionError);
  });

  it('fails loud when a sidebar target is not a measured chat route', () => {
    const doc = docFrom(
      '<body><aside aria-label="사이드바"><a href="/chat/" aria-label="Not a chat">Not a chat</a></aside></body>',
    );
    expect(() => claudeAdapter.listConversations?.(doc)).toThrow(ExtractionError);
  });
});
