import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { chatgptAdapter } from '../../src/adapters/chatgpt';
import { claudeAdapter } from '../../src/adapters/claude';
import { geminiAdapter } from '../../src/adapters/gemini';
import { assistantUnit, page as chatgptPage, turn as chatgptTurn, userUnit } from './chatgpt/markup';

// `Message.content` is Markdown by contract, but every provider puts *literal* user
// text on the page: ChatGPT and Claude in pre-wrap blocks, Gemini in per-line `<p>`s.
// Read raw, a turn typed as `**literal**` or `- item` becomes real formatting in both
// the Markdown and the PDF export, which is why each adapter escapes at the source.
// Found by the PR #77 review panel; these drive the real adapters end to end.
const TYPED = '**literal** and _under_\n- item';
const ESCAPED = '\\*\\*literal\\*\\* and \\_under\\_\n\\- item';

function docFrom(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

describe('a literally-typed user turn survives extraction unformatted', () => {
  it('chatgpt', async () => {
    const convo = await chatgptAdapter.extract(
      docFrom(
        chatgptPage('t', chatgptTurn('t1', userUnit('u1', TYPED), assistantUnit('a1 a1', '<p>ok</p>'))),
      ),
    );
    expect(convo.messages[0].content).toBe(ESCAPED);
  });

  it('claude', async () => {
    const convo = await claudeAdapter.extract(
      docFrom(
        '<html><head><title>t</title></head><body>' +
          '<div data-testid="user-message">' +
          '<p class="whitespace-pre-wrap">**literal** and _under_</p>' +
          '<p class="whitespace-pre-wrap">- item</p></div>' +
          '<div class="standard-markdown"><p>ok</p></div>' +
          '</body></html>',
      ),
    );
    expect(convo.messages[0].content).toBe('\\*\\*literal\\*\\* and \\_under\\_\n\n\\- item');
  });

  it('gemini', async () => {
    const convo = await geminiAdapter.extract(
      docFrom(
        '<html><head><title>t</title></head><body><div class="conversation-container">' +
          '<user-query><div class="query-text">' +
          '<p class="query-text-line">**literal** and _under_</p>' +
          '<p class="query-text-line">- item</p></div></user-query>' +
          '<message-content class="model-response-text"><p>ok</p></message-content>' +
          '</div></body></html>',
      ),
    );
    expect(convo.messages[0].content).toBe(ESCAPED);
  });
});
