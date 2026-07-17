import { describe, it, expect } from 'vitest';
import { assertConversationNonEmpty } from '../../src/content/guard';
import { ExtractionError } from '../../src/core/errors';
import { EXPORT_EMPTY_MESSAGE } from '../../src/strings';
import type { Conversation } from '../../src/core/conversation';

const base: Omit<Conversation, 'messages'> = {
  title: 'Untitled',
  provider: 'chatgpt',
  url: 'https://chatgpt.com/c/abc-123',
};

describe('assertConversationNonEmpty', () => {
  it('throws ExtractionError with the fail-loud message on zero messages', () => {
    const conversation: Conversation = { ...base, messages: [] };
    expect(() => assertConversationNonEmpty(conversation)).toThrow(ExtractionError);
    expect(() => assertConversationNonEmpty(conversation)).toThrow(EXPORT_EMPTY_MESSAGE);
  });

  it('passes through a conversation that has at least one message', () => {
    const conversation: Conversation = {
      ...base,
      messages: [{ role: 'user', content: 'hi' }],
    };
    expect(() => assertConversationNonEmpty(conversation)).not.toThrow();
  });
});
