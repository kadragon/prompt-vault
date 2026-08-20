import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { geminiAdapter } from '../../../src/adapters/gemini';
import { ExtractionError } from '../../../src/core/errors';

function docFrom(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

const FIRST = '0123456789abcdef';
const SECOND = 'fedcba9876543210';
const THIRD = 'abcdef0123456789';

function row(id: string, label: string, extra = ''): string {
  return `<gem-nav-list-item data-test-id="conversation"><a href="/app/${id}" aria-label="${label}">${label}</a>${extra}</gem-nav-list-item>`;
}

// The measured shape: the sidebar's own `infinite-scroller` carries NO test id, while the
// message list's carries `chat-history-container` (2026-08-10).
const SIDEBAR = `
  <body>
    <infinite-scroller data-test-id="chat-history-container">
      <div class="conversation-container"><a href="/app/${THIRD}">a link inside a message</a></div>
    </infinite-scroller>
    <infinite-scroller>
      ${row(FIRST, '첫 번째 대화')}
      ${row(SECOND, 'Second conversation')}
      ${row(FIRST, '첫 번째 대화')}
    </infinite-scroller>
  </body>`;

describe('geminiAdapter.listConversations', () => {
  it('enumerates measured sidebar anchors in order with canonical URLs', () => {
    expect(geminiAdapter.listConversations?.(docFrom(SIDEBAR))).toEqual([
      { id: FIRST, title: '첫 번째 대화', url: `https://gemini.google.com/app/${FIRST}` },
      { id: SECOND, title: 'Second conversation', url: `https://gemini.google.com/app/${SECOND}` },
    ]);
  });

  it('dedupes by conversation id and never reads the message list’s scroller as the sidebar', () => {
    const list = geminiAdapter.listConversations?.(docFrom(SIDEBAR)) ?? [];
    expect(list.filter((conversation) => conversation.id === FIRST)).toHaveLength(1);
    // The `/app/` anchor inside `chat-history-container` is an assistant link, not a row.
    expect(list.map((conversation) => conversation.id)).not.toContain(THIRD);
  });

  // A missing sidebar and an empty one render the SAME bulk-panel empty state, so the adapter is
  // the only place the two can be told apart (AGENTS.md #4).
  it('fails loud when no sidebar scroller resolves at all', () => {
    expect(() => geminiAdapter.listConversations?.(docFrom('<body><main>not ready</main></body>'))).toThrow(
      ExtractionError,
    );
  });

  it('fails loud when the only scroller present is the message list’s', () => {
    const doc = docFrom('<body><infinite-scroller data-test-id="chat-history-container"></infinite-scroller></body>');
    expect(() => geminiAdapter.listConversations?.(doc)).toThrow(ExtractionError);
  });

  it('returns an empty list when the sidebar rendered but holds no conversations', () => {
    expect(geminiAdapter.listConversations?.(docFrom('<body><infinite-scroller></infinite-scroller></body>'))).toEqual(
      [],
    );
  });

  // Measured 2026-08-10: collapsed, a `/app` page renders 31 rows and ZERO anchors. Returning `[]`
  // there would show a full account as "no conversations".
  it('fails loud on the collapsed sidebar shape rather than reporting an empty account', () => {
    const doc = docFrom(
      '<body><infinite-scroller>' +
        '<gem-nav-list-item data-test-id="conversation"><span>제목</span></gem-nav-list-item>' +
        '<gem-nav-list-item data-test-id="conversation"><span>제목</span></gem-nav-list-item>' +
        '</infinite-scroller></body>',
    );
    expect(() => geminiAdapter.listConversations?.(doc)).toThrow(/collapsed/i);
  });

  it('skips an anchor whose route was never measured and still returns the readable ones', () => {
    const doc = docFrom(
      `<body><infinite-scroller>
        ${row(FIRST, 'First')}
        <gem-nav-list-item data-test-id="conversation"><a href="/app/${SECOND}/share" aria-label="Shared">Shared</a></gem-nav-list-item>
        <gem-nav-list-item data-test-id="conversation"><a href="/app/not-hex" aria-label="Gem">Gem</a></gem-nav-list-item>
        ${row(THIRD, 'Third')}
      </infinite-scroller></body>`,
    );
    expect(geminiAdapter.listConversations?.(doc)?.map((conversation) => conversation.id)).toEqual([FIRST, THIRD]);
  });

  // The id is the identity; the title is only the checklist caption. Dropping the row would cost
  // the user a conversation for a missing label.
  it('labels a title-less anchor generically instead of dropping its conversation', () => {
    const doc = docFrom(
      `<body><infinite-scroller><gem-nav-list-item data-test-id="conversation"><a href="/app/${FIRST}"></a></gem-nav-list-item></infinite-scroller></body>`,
    );
    expect(geminiAdapter.listConversations?.(doc)).toEqual([
      { id: FIRST, title: 'Gemini conversation', url: `https://gemini.google.com/app/${FIRST}` },
    ]);
  });

  it('fails loud when the sidebar rendered anchors but none is a conversation route', () => {
    const doc = docFrom(
      '<body><infinite-scroller><gem-nav-list-item data-test-id="conversation">' +
        '<a href="/app/" aria-label="새 채팅">새 채팅</a></gem-nav-list-item></infinite-scroller></body>',
    );
    expect(() => geminiAdapter.listConversations?.(doc)).toThrow(ExtractionError);
  });
});
