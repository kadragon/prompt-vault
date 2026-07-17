import { describe, it, expect } from 'vitest';
import type { Conversation } from '../../src/core/conversation';
import { htmlFilename, toHtml } from '../../src/export/html';

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

describe('toHtml', () => {
  it('emits a self-contained HTML5 document (doctype + charset + title)', () => {
    const out = toHtml(conversation());
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain('<title>My chat</title>');
    expect(out).toContain('<h1>My chat</h1>');
    expect(out.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('renders a role heading and a <pre> body per message, in order', () => {
    const out = toHtml(conversation());
    expect(out).toContain('<h2>User</h2><pre>Hello</pre>');
    expect(out).toContain('<h2>Assistant</h2><pre>Hi there</pre>');
    expect(out.indexOf('Hello')).toBeLessThan(out.indexOf('Hi there'));
  });

  it('labels a system message with its own heading', () => {
    expect(toHtml(conversation({ messages: [{ role: 'system', content: 'You are helpful.' }] }))).toContain(
      '<h2>System</h2><pre>You are helpful.</pre>',
    );
  });

  it('HTML-escapes message content so markup cannot inject into the document', () => {
    const out = toHtml(conversation({ messages: [{ role: 'user', content: '<script>alert("x" & 1 < 2)</script>' }] }));
    expect(out).toContain('&lt;script&gt;alert(&quot;x&quot; &amp; 1 &lt; 2)&lt;/script&gt;');
    expect(out).not.toContain('<script>');
  });

  it('HTML-escapes the title in both the <title> and the <h1>', () => {
    const out = toHtml(conversation({ title: '<b>A & B</b>', messages: [] }));
    expect(out).toContain('<title>&lt;b&gt;A &amp; B&lt;/b&gt;</title>');
    expect(out).toContain('<h1>&lt;b&gt;A &amp; B&lt;/b&gt;</h1>');
  });

  it('shows Markdown content verbatim (faithful source view — not rendered)', () => {
    const out = toHtml(conversation({ messages: [{ role: 'assistant', content: '**bold** and `code`' }] }));
    expect(out).toContain('<pre>**bold** and `code`</pre>');
  });

  it('renders a title-only document when there are no messages', () => {
    const out = toHtml(conversation({ title: 'Empty', messages: [] }));
    expect(out).toContain('<h1>Empty</h1>');
    expect(out).not.toContain('<pre>');
  });

  it('is deterministic — same conversation yields the same bytes', () => {
    const c = conversation();
    expect(toHtml(c)).toBe(toHtml(c));
  });
});

describe('htmlFilename', () => {
  const date = new Date(2026, 0, 5); // 2026-01-05 (local); month is 0-based

  it('builds {provider}-{safe-title}-{yyyymmdd}.html', () => {
    expect(htmlFilename(conversation({ title: 'My chat' }), date)).toBe('chatgpt-My-chat-20260105.html');
  });

  it('uses the conversation provider as the prefix', () => {
    expect(htmlFilename(conversation({ provider: 'gemini' }), date)).toMatch(/^gemini-/);
  });
});
