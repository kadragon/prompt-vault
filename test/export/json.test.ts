import { describe, it, expect } from 'vitest';
import type { Conversation } from '../../src/core/conversation';
import { jsonFilename, toJson } from '../../src/export/json';

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

describe('toJson', () => {
  it('serializes the full conversation as pretty-printed JSON with a trailing newline', () => {
    const c = conversation();
    const out = toJson(c);
    expect(out.endsWith('\n')).toBe(true);
    expect(out).toBe(JSON.stringify(c, null, 2) + '\n');
  });

  it('round-trips: JSON.parse(toJson(c)) deep-equals the conversation', () => {
    const c = conversation({ createdAt: '2026-07-17T00:00:00Z', messages: [{ role: 'user', content: 'x', id: 'm1' }] });
    expect(JSON.parse(toJson(c))).toEqual(c);
  });

  it('omits undefined optional fields rather than emitting null', () => {
    const out = toJson(conversation()); // no createdAt, message ids
    expect(out).not.toContain('createdAt');
    expect(out).not.toContain('"id"');
    expect(out).not.toContain('null');
  });

  it('preserves message order', () => {
    const parsed = JSON.parse(
      toJson(
        conversation({
          messages: [
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'second' },
            { role: 'user', content: 'third' },
          ],
        }),
      ),
    ) as Conversation;
    expect(parsed.messages.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });

  it('serializes a conversation with no messages', () => {
    const parsed = JSON.parse(toJson(conversation({ messages: [] }))) as Conversation;
    expect(parsed.messages).toEqual([]);
  });

  it('is deterministic — same conversation yields the same bytes', () => {
    const c = conversation();
    expect(toJson(c)).toBe(toJson(c));
  });
});

describe('jsonFilename', () => {
  const date = new Date(2026, 0, 5); // 2026-01-05 (local); month is 0-based

  it('builds {provider}-{safe-title}-{yyyymmdd}.json', () => {
    expect(jsonFilename(conversation({ title: 'My chat' }), date)).toBe('chatgpt-My-chat-20260105.json');
  });

  it('uses the conversation provider as the prefix', () => {
    expect(jsonFilename(conversation({ provider: 'gemini' }), date)).toMatch(/^gemini-/);
  });
});
