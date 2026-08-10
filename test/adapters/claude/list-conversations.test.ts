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

  it('returns an empty list while the measured sidebar is absent', () => {
    expect(claudeAdapter.listConversations?.(docFrom('<body><main>not ready</main></body>'))).toEqual([]);
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
