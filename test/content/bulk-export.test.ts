import { describe, it, expect, vi } from 'vitest';
import type { Conversation } from '../../src/core/conversation';
import type { ExportFormat } from '../../src/content/save-conversation';
import { bulkExport } from '../../src/content/bulk-export';

function conversation(title: string): Conversation {
  return {
    title,
    provider: 'chatgpt',
    url: `https://chatgpt.com/c/${title}`,
    messages: [{ role: 'user', content: 'hi' }],
  };
}

const NOW = new Date(2026, 6, 17);

// A save spy plus a no-wait sleep spy, so the loop runs with no real downloads/timers.
function deps(save: (c: Conversation, f: ExportFormat, now: Date) => Promise<void>) {
  const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
  return { save: vi.fn(save), sleep };
}

describe('bulkExport', () => {
  it('saves every conversation in order and reports an all-success summary', async () => {
    const saved: string[] = [];
    const { save, sleep } = deps((c) => {
      saved.push(c.title);
      return Promise.resolve();
    });
    const convs = [conversation('a'), conversation('b'), conversation('c')];

    const summary = await bulkExport(convs, 'md', NOW, { save, sleep });

    expect(saved).toEqual(['a', 'b', 'c']);
    expect(summary).toEqual({ total: 3, succeeded: 3, failed: [] });
    expect(save).toHaveBeenCalledWith(convs[0], 'md', NOW);
  });

  it('captures a mid-list failure and still saves the remaining conversations', async () => {
    const saved: string[] = [];
    const { save, sleep } = deps((c) => {
      if (c.title === 'b') return Promise.reject(new Error('extract failed'));
      saved.push(c.title);
      return Promise.resolve();
    });
    const convs = [conversation('a'), conversation('b'), conversation('c')];

    const summary = await bulkExport(convs, 'md', NOW, { save, sleep });

    expect(saved).toEqual(['a', 'c']); // b failed, c still ran
    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toEqual([{ title: 'b', error: 'extract failed' }]);
  });

  it('stringifies a non-Error thrown value into the failure message', async () => {
    // Deliberately reject with a non-Error to exercise bulkExport's String(error) branch.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const { save, sleep } = deps(() => Promise.reject('boom'));
    const summary = await bulkExport([conversation('a')], 'md', NOW, { save, sleep });
    expect(summary.failed).toEqual([{ title: 'a', error: 'boom' }]);
  });

  it('sleeps between saves only — n-1 times for n conversations', async () => {
    const { save, sleep } = deps(() => Promise.resolve());
    await bulkExport([conversation('a'), conversation('b'), conversation('c')], 'md', NOW, { save, sleep });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not sleep after a single conversation', async () => {
    const { save, sleep } = deps(() => Promise.resolve());
    await bulkExport([conversation('a')], 'md', NOW, { save, sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('passes the configured delay to sleep', async () => {
    const { save, sleep } = deps(() => Promise.resolve());
    await bulkExport([conversation('a'), conversation('b')], 'md', NOW, { save, sleep, delayMs: 750 });
    expect(sleep).toHaveBeenCalledWith(750);
  });

  it('returns an empty summary and never saves or sleeps for no conversations', async () => {
    const { save, sleep } = deps(() => Promise.resolve());
    const summary = await bulkExport([], 'pdf', NOW, { save, sleep });
    expect(summary).toEqual({ total: 0, succeeded: 0, failed: [] });
    expect(save).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});
