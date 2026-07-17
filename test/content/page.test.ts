import { describe, it, expect } from 'vitest';
import { isConversationPage } from '../../src/content/page';

describe('isConversationPage', () => {
  it('accepts a ChatGPT conversation URL', () => {
    expect(isConversationPage('https://chatgpt.com/c/abc-123')).toBe(true);
    expect(isConversationPage('https://chatgpt.com/c/abc-123/')).toBe(true);
    expect(isConversationPage('https://chat.openai.com/c/xyz')).toBe(true);
  });

  it('rejects non-conversation paths on a supported host', () => {
    expect(isConversationPage('https://chatgpt.com/')).toBe(false);
    expect(isConversationPage('https://chatgpt.com/c/')).toBe(false);
    expect(isConversationPage('https://chatgpt.com/gpts')).toBe(false);
    expect(isConversationPage('https://chatgpt.com/c/abc/extra')).toBe(false);
  });

  it('rejects unsupported and look-alike hosts', () => {
    expect(isConversationPage('https://example.com/c/abc')).toBe(false);
    expect(isConversationPage('https://chatgpt.com.attacker.example/c/abc')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isConversationPage('not a url')).toBe(false);
    expect(isConversationPage('')).toBe(false);
  });
});
