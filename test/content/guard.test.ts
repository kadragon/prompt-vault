import { describe, it, expect } from 'vitest';
import { assertConversationNonEmpty } from '../../src/content/guard';
import { ExtractionError } from '../../src/core/errors';
import { EXPORT_EMPTY_MESSAGE } from '../../src/strings';
import { conversation } from '../fixtures/conversation';

describe('assertConversationNonEmpty', () => {
  it('throws ExtractionError with the fail-loud message on zero messages', () => {
    const empty = conversation({ messages: [] });
    expect(() => assertConversationNonEmpty(empty)).toThrow(ExtractionError);
    expect(() => assertConversationNonEmpty(empty)).toThrow(EXPORT_EMPTY_MESSAGE);
  });

  it('passes through a conversation that has at least one message', () => {
    expect(() => assertConversationNonEmpty(conversation())).not.toThrow();
  });
});
