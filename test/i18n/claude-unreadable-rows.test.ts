import { describe, it, expect } from 'vitest';
import { errClaudeTurnGapMessage, errClaudeUnreadableRowsMessage } from '../../src/strings';

// The singular and plural keys share the "could not read" phrase every extraction test
// matches on, so swapping them — or the plural regressing to "position" — stays green
// there. Pin the number agreement on the helper that picks the key.
describe('errClaudeUnreadableRowsMessage', () => {
  it('uses the singular sentence for one position', () => {
    const message = errClaudeUnreadableRowsMessage([3]);
    expect(message).toContain('a message at position 4 ');
    expect(message).toContain('the message may be of a type');
  });

  it('uses the plural sentence for several positions', () => {
    const message = errClaudeUnreadableRowsMessage([3, 5]);
    expect(message).toContain('messages at positions 4, 6 ');
    expect(message).toContain('the messages may be of a type');
  });

  // The adapter counts rows from zero; a user counts messages from one. "Position 0" reads
  // as a bug in the report itself.
  it('shows the first message as position 1, not 0', () => {
    expect(errClaudeUnreadableRowsMessage([0])).toContain('at position 1 ');
  });
});

describe('errClaudeTurnGapMessage', () => {
  it('shows one-based positions', () => {
    expect(errClaudeTurnGapMessage(0, 2)).toContain('between positions 1 and 3.');
  });
});
