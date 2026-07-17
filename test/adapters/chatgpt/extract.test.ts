import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { chatgptAdapter } from '../../../src/adapters/chatgpt';
import { ExtractionError } from '../../../src/core/errors';
import type { Conversation } from '../../../src/core/conversation';

// Load a captured fixture into a parsed document and run the adapter against it.
// Passing this document (not the global one) makes the adapter skip auto-scroll.
function extractFixture(name: string): Promise<Conversation> {
  const path = fileURLToPath(new URL(`../../fixtures/chatgpt/${name}`, import.meta.url));
  const html = readFileSync(path, 'utf-8');
  const window = new Window();
  window.document.write(html);
  return chatgptAdapter.extract(window.document as unknown as Document);
}

describe('chatgptAdapter.extract', () => {
  it('extracts both roles in order with ids from a normal conversation', async () => {
    const convo = await extractFixture('short.html');

    expect(convo.provider).toBe('chatgpt');
    expect(convo.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(convo.messages.every((m) => typeof m.id === 'string' && m.id.length > 0)).toBe(true);
    expect(convo.title).toBe('마크다운 데모 요청');
  });

  it('normalizes assistant formatting to Markdown', async () => {
    const convo = await extractFixture('short.html');
    const assistant = convo.messages[1].content;

    expect(assistant).toContain('**'); // bold
    expect(assistant).toContain('*'); // italic
    expect(assistant).toMatch(/^- /m); // bullet list
    expect(assistant).toMatch(/^1\. /m); // ordered list
    expect(assistant).toContain('```python'); // fenced code with language
    expect(assistant).toContain('](https://example.com)'); // link
  });

  it('preserves user text verbatim (raw markdown-ish source)', async () => {
    const convo = await extractFixture('short.html');
    expect(convo.messages[0].content).toContain('마크다운 형식 데모');
  });

  it('tags code blocks with the header language across languages', async () => {
    const convo = await extractFixture('code-heavy.html');
    const assistant = convo.messages.find((m) => m.role === 'assistant')!.content;

    expect(assistant).toContain('```python');
    expect(assistant).toContain('```javascript');
    expect(assistant).toContain('```bash');
  });

  it('fails loud when no messages are present', async () => {
    await expect(extractFixture('empty.html')).rejects.toBeInstanceOf(ExtractionError);
  });
});
