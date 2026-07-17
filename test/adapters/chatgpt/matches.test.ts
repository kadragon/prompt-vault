import { describe, it, expect } from 'vitest';
import { matches } from '../../../src/adapters/chatgpt/matches';

describe('chatgpt matches', () => {
  it('accepts a ChatGPT conversation URL', () => {
    expect(matches('https://chatgpt.com/c/abc-123')).toBe(true);
    expect(matches('https://chatgpt.com/c/abc-123/')).toBe(true);
    expect(matches('https://chat.openai.com/c/xyz')).toBe(true);
  });

  it('rejects non-conversation paths on a supported host', () => {
    expect(matches('https://chatgpt.com/')).toBe(false);
    expect(matches('https://chatgpt.com/c/')).toBe(false);
    expect(matches('https://chatgpt.com/gpts')).toBe(false);
    expect(matches('https://chatgpt.com/c/abc/extra')).toBe(false);
  });

  it('rejects unsupported and look-alike hosts', () => {
    expect(matches('https://example.com/c/abc')).toBe(false);
    expect(matches('https://chatgpt.com.attacker.example/c/abc')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(matches('not a url')).toBe(false);
  });
});
