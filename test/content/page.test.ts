import { describe, it, expect } from 'vitest';
import { isConversationPage, isProjectPage } from '../../src/content/page';

describe('isConversationPage', () => {
  it('accepts a ChatGPT conversation URL', () => {
    expect(isConversationPage('https://chatgpt.com/c/abc-123')).toBe(true);
    expect(isConversationPage('https://chatgpt.com/c/abc-123/')).toBe(true);
    expect(isConversationPage('https://chat.openai.com/c/xyz')).toBe(true);
  });

  // The gate asks the adapter registry rather than naming a provider, so registering an
  // adapter is all it takes for its pages to mount.
  it('accepts a Claude conversation URL', () => {
    expect(isConversationPage('https://claude.ai/chat/abc-123')).toBe(true);
    expect(isConversationPage('https://claude.ai/chat/abc-123/')).toBe(true);
  });

  it('rejects non-conversation paths on Claude', () => {
    expect(isConversationPage('https://claude.ai/')).toBe(false);
    expect(isConversationPage('https://claude.ai/chat/')).toBe(false);
    expect(isConversationPage('https://claude.ai/recents')).toBe(false);
    expect(isConversationPage('https://claude.ai.attacker.example/chat/abc')).toBe(false);
  });

  it('does not let one provider’s path shape leak onto another’s host', () => {
    expect(isConversationPage('https://claude.ai/c/abc-123')).toBe(false);
    expect(isConversationPage('https://chatgpt.com/chat/abc-123')).toBe(false);
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

describe('isProjectPage', () => {
  it('accepts a ChatGPT project home page', () => {
    expect(isProjectPage('https://chatgpt.com/g/g-p-abc123/project')).toBe(true);
  });

  it('accepts both measured Claude project-home route families', () => {
    expect(isProjectPage('https://claude.ai/cowork/project/abc-123')).toBe(true);
    expect(isProjectPage('https://claude.ai/project/abc-123')).toBe(true);
    expect(isProjectPage('https://claude.ai/chat/abc-123')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isProjectPage('not a url')).toBe(false);
  });
});
