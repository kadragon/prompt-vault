import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { claudeAdapter } from '../../../src/adapters/claude';
import { ExtractionError } from '../../../src/core/errors';

// Passing a non-global document is what makes the adapter take the one-shot snapshot
// path instead of the live scroll walk (which `collect-virtualized.test.ts` covers).
function docFrom(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

function loadFixture(name: string): Document {
  const path = fileURLToPath(new URL(`../../fixtures/claude/${name}`, import.meta.url));
  return docFrom(readFileSync(path, 'utf-8'));
}

describe('claudeAdapter.extract', () => {
  it('stamps the provider and the title, stripping Claude’s document-title suffix', async () => {
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.provider).toBe('claude');
    // document.title is "Fixture conversation - Claude" (live format verified 2026-07-25).
    expect(convo.title).toBe('Fixture conversation');
  });

  it('falls back to a generic title when the page has no conversation title yet', async () => {
    const convo = await claudeAdapter.extract(
      docFrom(
        '<html><head><title>Claude</title></head><body>' +
          '<div data-index="0"><div class="standard-markdown"><p>hi</p></div></div>' +
          '</body></html>',
      ),
    );
    expect(convo.title).toBe('Claude conversation');
  });

  it('reads both roles in on-screen order', async () => {
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('keeps the newlines a user typed and separates their paragraphs', async () => {
    // User bodies are `p.whitespace-pre-wrap`, so interior newlines are content, not
    // markup whitespace — they must not go through the serializer's collapsing path.
    const [first] = (await claudeAdapter.extract(loadFixture('short.html'))).messages;
    expect(first.content).toBe(
      'First user question.\nSecond line of the same paragraph.\n\nA separate paragraph.',
    );
  });

  it('preserves list markers in a user turn', async () => {
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.messages[2].content).toBe('A follow-up with a list:\n\n- alpha\n- beta');
  });

  it('serializes assistant prose to Markdown, including lists and a language-tagged fence', async () => {
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.messages[1].content).toBe(
      'Here is an answer with **bold** and `inline code`.\n\n' +
        '1. First step\n2. Second step\n\n' +
        '```sql\nSELECT id\nFROM users;\n```',
    );
  });

  it('omits the message id, which Claude does not expose', async () => {
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.messages.every((m) => m.id === undefined)).toBe(true);
  });

  it('fails loud rather than returning an empty conversation', async () => {
    await expect(claudeAdapter.extract(docFrom('<body><main>no turns here</main></body>'))).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });

  it('fails loud when a turn is present but unreadable, instead of dropping it', async () => {
    const html =
      '<body>' +
      '<div data-index="0"><div data-testid="user-message"><p>a question</p></div></div>' +
      // An assistant container that rendered with no content at all.
      '<div data-index="1"><div class="standard-markdown"></div></div>' +
      '</body>';
    await expect(claudeAdapter.extract(docFrom(html))).rejects.toBeInstanceOf(ExtractionError);
  });

  it('does not double-count: a user bubble and an assistant container never overlap', async () => {
    // Live-verified (2026-07-25): zero `.standard-markdown` nested inside a user turn, so
    // the union selector yields each turn exactly once.
    const convo = await claudeAdapter.extract(loadFixture('short.html'));
    expect(convo.messages).toHaveLength(4);
  });
});
