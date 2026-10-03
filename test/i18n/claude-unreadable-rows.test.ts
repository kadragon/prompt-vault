import { describe, it, expect } from 'vitest';
import { errClaudeUnreadableRowsMessage } from '../../src/strings';

// The singular and plural keys share the "could not read" phrase every extraction test
// matches on, so swapping them — or the plural regressing to "position" — stays green
// there. Pin the number agreement on the helper that picks the key.
describe('errClaudeUnreadableRowsMessage', () => {
  it('uses the singular sentence for one position', () => {
    const message = errClaudeUnreadableRowsMessage([3]);
    expect(message).toContain('a message at position 3 ');
    expect(message).toContain('the message may be of a type');
  });

  it('uses the plural sentence for several positions', () => {
    const message = errClaudeUnreadableRowsMessage([3, 5]);
    expect(message).toContain('messages at positions 3, 5 ');
    expect(message).toContain('the messages may be of a type');
  });
});
