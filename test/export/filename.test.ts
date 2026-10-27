import { describe, it, expect } from 'vitest';
import { conversation } from '../fixtures/conversation';
import { buildShareFilename } from '../../src/export/filename';

describe('buildShareFilename', () => {
  const now = new Date(2026, 0, 5, 23, 59);

  it('names the share copy {provider}-shared-{yyyymmdd}.md', () => {
    expect(buildShareFilename(conversation({ provider: 'claude' }), now)).toBe(
      'claude-shared-20260105.md',
    );
  });

  it('does not depend on the title', () => {
    const names = ['Acme deal for jane@x.io', '', '공유된 대화', 'a/b:c'].map((title) =>
      buildShareFilename(conversation({ title }), now),
    );
    expect(new Set(names)).toEqual(new Set(['chatgpt-shared-20260105.md']));
  });
});
