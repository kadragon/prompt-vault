import type { Conversation } from '../../src/core/conversation';

/**
 * The one place a test builds a `Conversation` by hand: a two-turn ChatGPT chat, with any
 * field overridable. A field added to the model is added here once, not in every test file.
 */
export function conversation(overrides: Partial<Conversation> = {}): Conversation {
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
