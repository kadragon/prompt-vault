import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { chatgptAdapter } from '../../../src/adapters/chatgpt';
import { assistantUnit, turn, userUnit } from './markup';

// The app-shell keeps previously visited routes mounted as hidden siblings of the page on
// screen (measured 2026-09-29: 4 `data-app-shell-active-page="false"` wrappers, each
// `display: none` with its own header, thread and project list, before the one active page).
// A hidden route listed FIRST is the dangerous order: a document-wide query lands on it.
function header(label: string): string {
  return (
    '<header><div data-testid="app-shell-header-context-menu-surface">' +
    `<div class="flex items-center gap-toolbar-action" data-pane="${label}"><button>Share</button></div>` +
    '</div></header>'
  );
}

function pane(active: boolean, label: string, body: string): string {
  return (
    `<div data-app-shell-active-page="${active}"><div${active ? '' : ' style="display:none"'}>` +
    `${header(label)}<main>${body}</main></div></div>`
  );
}

function docFrom(html: string): Document {
  const window = new Window();
  window.document.write(`<body>${html}</body>`);
  return window.document as unknown as Document;
}

const thread = (id: string, text: string): string =>
  turn(`t-${id}`, userUnit(`u-${id}`, text), assistantUnit(`a-${id} a-${id}`, `<p>${text} reply</p>`));

describe('ChatGPT adapter scopes page reads to the active route', () => {
  const doc = docFrom(
    pane(false, 'hidden', thread('old', 'hidden prompt')) +
      pane(true, 'active', thread('new', 'active prompt')),
  );

  it('mounts the toolbar in the visible header, not a hidden route header', () => {
    expect(chatgptAdapter.toolbarMount?.(doc)?.getAttribute('data-pane')).toBe('active');
  });

  it('extracts only the visible conversation, never a hidden route thread', async () => {
    const conversation = await chatgptAdapter.extract(doc);
    const text = conversation.messages.map((m) => m.content).join('\n');
    expect(conversation.messages).toHaveLength(2);
    expect(text).toContain('active prompt');
    expect(text).not.toContain('hidden prompt');
  });

  it('lists the visible project home, not a hidden one', () => {
    const list = (id: string): string =>
      `<section><ol><li><a href="/g/g-p-abc/c/${id}"><div class="text-sm font-medium">${id}</div></a></li></ol></section>`;
    const projectDoc = docFrom(pane(false, 'hidden', list('conv-hidden')) + pane(true, 'active', list('conv-shown')));
    const ids = (chatgptAdapter.listProjectConversations?.(projectDoc) ?? []).map((c) => c.id);
    expect(ids).toEqual(['conv-shown']);
  });
});
