import { describe, it, expect } from 'vitest';
import type { Conversation } from '../../src/core/conversation';
import { PDF_FONT, pdfFilename, toPdfDocDefinition } from '../../src/export/pdf';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    title: 'My chat',
    provider: 'chatgpt',
    url: 'https://chatgpt.com/c/abc',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ],
    ...overrides,
  };
}

// The content array is typed as Content (a broad union); tests know each node we
// emit is a text node, so narrow to read `.text`/`.style`.
function nodes(c: Conversation): Array<{ text?: unknown; style?: unknown; margin?: unknown }> {
  const content = toPdfDocDefinition(c).content;
  return content as Array<{ text?: unknown; style?: unknown; margin?: unknown }>;
}

describe('toPdfDocDefinition', () => {
  it('uses the embedded Jetendard font as the default style', () => {
    const def = toPdfDocDefinition(conversation());
    expect(def.defaultStyle).toMatchObject({ font: PDF_FONT });
  });

  it('places the title first as a title-styled node', () => {
    const [first] = nodes(conversation({ title: 'Weekend plan' }));
    expect(first).toMatchObject({ text: 'Weekend plan', style: 'title' });
  });

  it('flattens newlines in the title into a single line', () => {
    const [first] = nodes(conversation({ title: 'line one\nline two' }));
    expect(first).toMatchObject({ text: 'line one line two' });
  });

  it('emits role labels in message order', () => {
    const roleTexts = nodes(
      conversation({
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'system', content: 'third' },
        ],
      }),
    )
      .filter((n) => n.style === 'role')
      .map((n) => n.text);
    expect(roleTexts).toEqual(['User', 'Assistant', 'System']);
  });

  it('renders a fenced code block as a distinct code-styled node without the fences', () => {
    const content = 'before\n\n```py\nx = 1\n```\n\nafter';
    const all = nodes(conversation({ messages: [{ role: 'assistant', content }] }));
    const code = all.find((n) => n.style === 'code');
    expect(code).toBeDefined();
    expect(code?.text).toBe('x = 1');
    // The prose on either side survives as its own (non-code) nodes.
    const proseTexts = all.filter((n) => !n.style && typeof n.text === 'string').map((n) => n.text);
    expect(proseTexts).toContain('before');
    expect(proseTexts).toContain('after');
  });

  it('carries CJK text through into the document definition', () => {
    const all = nodes(conversation({ messages: [{ role: 'user', content: '안녕하세요 세계' }] }));
    expect(all.some((n) => n.text === '안녕하세요 세계')).toBe(true);
  });

  it('renders a title-only document when there are no messages', () => {
    const content = toPdfDocDefinition(conversation({ title: 'Empty', messages: [] })).content;
    expect(content).toEqual([{ text: 'Empty', style: 'title' }]);
  });

  it('is deterministic — same conversation yields a deep-equal definition', () => {
    const c = conversation();
    expect(toPdfDocDefinition(c)).toEqual(toPdfDocDefinition(c));
  });
});

describe('pdfFilename', () => {
  const date = new Date(2026, 0, 5); // 2026-01-05 (local); month is 0-based

  it('builds {provider}-{safe-title}-{yyyymmdd}.pdf', () => {
    expect(pdfFilename(conversation({ title: 'My chat' }), date)).toBe('chatgpt-My-chat-20260105.pdf');
  });

  it('shares sanitization with the other exporters (reserved chars → dashes)', () => {
    expect(pdfFilename(conversation({ title: 'a/b:c*?"<>|d' }), date)).toBe('chatgpt-a-b-c-d-20260105.pdf');
  });

  it('keeps the filename within the UTF-8 byte budget for a long CJK title', () => {
    const name = pdfFilename(conversation({ title: '가'.repeat(100) }), date);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
  });
});
