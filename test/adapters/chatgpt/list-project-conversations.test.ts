import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { chatgptAdapter } from '../../../src/adapters/chatgpt';

function docFrom(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

// A Project home page's conversation list, mirroring the live structure verified
// 2026-07-18: <main> → <section> → <ol> → <li class="group/project-item"> → an anchor
// whose href is `/g/g-p-<id>-<slug>/c/<convId>`, with the human title in a `.font-medium`
// block and a message-preview snippet in a sibling block (which must NOT be read as the
// title). The last row repeats the first conversation's id via the slug-less
// `/g/g-p-<id>/c/<convId>` form (as the sidebar expando renders it) to prove dedupe.
// Synthetic ids/titles only — no real conversation content is committed.
const PROJECT = `
  <body>
    <main>
      <section>
        <ol class="divide-y">
          <li class="group/project-item">
            <div>
              <a href="/g/g-p-proj1-demo/c/conv-aaa" data-discover="true">
                <div class="text-sm font-medium">First project chat</div>
                <div class="text-token-text-secondary truncate">preview snippet, not the title</div>
              </a>
              <button data-conversation-options-trigger="conv-aaa" aria-label="First project chat options"></button>
            </div>
          </li>
          <li class="group/project-item">
            <div>
              <a href="/g/g-p-proj1-demo/c/conv-bbb" data-discover="true">
                <div class="text-sm font-medium">Second project chat</div>
                <div class="text-token-text-secondary truncate">another preview</div>
              </a>
            </div>
          </li>
          <li class="group/project-item">
            <div>
              <a href="/g/g-p-proj1/c/conv-aaa" data-discover="true">
                <div class="text-sm font-medium">First project chat</div>
              </a>
            </div>
          </li>
        </ol>
      </section>
    </main>
  </body>`;

describe('chatgptAdapter.listProjectConversations', () => {
  it('enumerates project conversations in order, titling from the font-medium block', () => {
    const list = chatgptAdapter.listProjectConversations?.(docFrom(PROJECT)) ?? [];
    expect(list).toEqual([
      { id: 'conv-aaa', title: 'First project chat', url: 'https://chatgpt.com/g/g-p-proj1-demo/c/conv-aaa' },
      { id: 'conv-bbb', title: 'Second project chat', url: 'https://chatgpt.com/g/g-p-proj1-demo/c/conv-bbb' },
    ]);
  });

  it('does not use the message-preview snippet as the title', () => {
    const list = chatgptAdapter.listProjectConversations?.(docFrom(PROJECT)) ?? [];
    expect(list.map((c) => c.title)).not.toContain('preview snippet, not the title');
  });

  it('dedupes by conversation id across the slug and slug-less href forms', () => {
    const list = chatgptAdapter.listProjectConversations?.(docFrom(PROJECT)) ?? [];
    expect(list.filter((c) => c.id === 'conv-aaa')).toHaveLength(1);
  });

  it('returns an empty list when no project conversation list is present', () => {
    const list = chatgptAdapter.listProjectConversations?.(docFrom('<body><main>empty project</main></body>')) ?? [];
    expect(list).toEqual([]);
  });

  it('falls back to a generic title when the title block and link text are empty', () => {
    const doc = docFrom(
      '<body><section><ol><li><a href="/g/g-p-x/c/conv-eee" data-discover="true"></a></li></ol></section></body>',
    );
    const list = chatgptAdapter.listProjectConversations?.(doc) ?? [];
    expect(list).toEqual([
      { id: 'conv-eee', title: 'ChatGPT conversation', url: 'https://chatgpt.com/g/g-p-x/c/conv-eee' },
    ]);
  });
});
