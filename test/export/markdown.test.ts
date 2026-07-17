import { describe, it, expect } from 'vitest';
import type { Conversation } from '../../src/core/conversation';
import { markdownFilename, toMarkdown } from '../../src/export/markdown';

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

describe('toMarkdown', () => {
  it('composes a title heading and role-labeled sections in order', () => {
    expect(toMarkdown(conversation())).toBe(
      '# My chat\n\n## User\n\nHello\n\n## Assistant\n\nHi there\n',
    );
  });

  it('labels each role with its own heading', () => {
    const md = toMarkdown(
      conversation({ messages: [{ role: 'system', content: 'You are helpful.' }] }),
    );
    expect(md).toBe('# My chat\n\n## System\n\nYou are helpful.\n');
  });

  it('passes already-Markdown content through verbatim (code, lists, bold, links)', () => {
    const content = '**bold** and [a link](https://x.test)\n\n- one\n- two\n\n```py\nx = 1\n```';
    const md = toMarkdown(conversation({ messages: [{ role: 'assistant', content }] }));
    expect(md).toBe(`# My chat\n\n## Assistant\n\n${content}\n`);
  });

  it('preserves message order', () => {
    const md = toMarkdown(
      conversation({
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'user', content: 'third' },
        ],
      }),
    );
    expect(md.indexOf('first')).toBeLessThan(md.indexOf('second'));
    expect(md.indexOf('second')).toBeLessThan(md.indexOf('third'));
  });

  it('flattens newlines in the title into a single heading line', () => {
    expect(toMarkdown(conversation({ title: 'line one\nline two' }))).toContain(
      '# line one line two\n',
    );
  });

  it('is deterministic — same conversation yields the same bytes', () => {
    const c = conversation();
    expect(toMarkdown(c)).toBe(toMarkdown(c));
  });

  it('renders a title-only document when there are no messages', () => {
    expect(toMarkdown(conversation({ title: 'Empty', messages: [] }))).toBe('# Empty\n');
  });

  it('escapes Markdown-significant characters in the title heading', () => {
    expect(toMarkdown(conversation({ title: '# real?', messages: [] }))).toBe('# \\# real?\n');
    expect(toMarkdown(conversation({ title: '1) foo', messages: [] }))).toBe('# 1\\) foo\n');
    expect(toMarkdown(conversation({ title: '[x](y)', messages: [] }))).toBe('# \\[x\\](y)\n');
  });

  it('leaves already-Markdown message content unescaped', () => {
    const content = '# a real heading in content\n\n- a real bullet';
    const md = toMarkdown(conversation({ messages: [{ role: 'assistant', content }] }));
    expect(md).toBe(`# My chat\n\n## Assistant\n\n${content}\n`);
  });
});

describe('markdownFilename', () => {
  const date = new Date(2026, 0, 5); // 2026-01-05 (local); month is 0-based

  it('builds {provider}-{safe-title}-{yyyymmdd}.md', () => {
    expect(markdownFilename(conversation({ title: 'My chat' }), date)).toBe(
      'chatgpt-My-chat-20260105.md',
    );
  });

  it('zero-pads the date components', () => {
    expect(markdownFilename(conversation(), new Date(2026, 2, 7))).toContain('-20260307.md');
  });

  it('replaces path separators and reserved characters', () => {
    expect(markdownFilename(conversation({ title: 'a/b:c*?"<>|d' }), date)).toBe(
      'chatgpt-a-b-c-d-20260105.md',
    );
  });

  it('strips control characters', () => {
    // Literal C0 control chars written as escapes so the file stays textual.
    expect(markdownFilename(conversation({ title: 'a\x00\x1fb' }), date)).toBe(
      'chatgpt-a-b-20260105.md',
    );
  });

  it('falls back to "conversation" for an empty or all-reserved title', () => {
    expect(markdownFilename(conversation({ title: '   ' }), date)).toBe(
      'chatgpt-conversation-20260105.md',
    );
    expect(markdownFilename(conversation({ title: '///' }), date)).toBe(
      'chatgpt-conversation-20260105.md',
    );
  });

  it('caps a long title without leaving a trailing dash', () => {
    const title = 'word-'.repeat(40); // far longer than the 80-code-point cap
    const name = markdownFilename(conversation({ title }), date);
    const slug = name.replace(/^chatgpt-/, '').replace(/-20260105\.md$/, '');
    expect([...slug].length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('keeps the filename within the UTF-8 byte budget for a long CJK title', () => {
    const name = markdownFilename(conversation({ title: '가'.repeat(100) }), date);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
  });

  it('never splits a surrogate pair when truncating an astral-char title', () => {
    // '😀' is a surrogate pair (4 UTF-8 bytes); a naive UTF-16 slice could cut one
    // in half, producing a lone surrogate. encodeURIComponent throws on those.
    const name = markdownFilename(conversation({ title: 'a' + '😀'.repeat(80) }), date);
    expect(() => encodeURIComponent(name)).not.toThrow();
  });

  it('uses the conversation provider as the prefix', () => {
    expect(markdownFilename(conversation({ provider: 'gemini' }), date)).toMatch(/^gemini-/);
  });
});
