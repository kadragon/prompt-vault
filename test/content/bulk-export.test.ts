import { describe, it, expect, vi } from 'vitest';
import type { Conversation } from '../../src/core/conversation';
import type { ExportFormat } from '../../src/content/save-conversation';
import { bulkExport, type BulkTarget } from '../../src/content/bulk-export';

function conversation(title: string): Conversation {
  return {
    title,
    provider: 'chatgpt',
    url: `https://chatgpt.com/c/${title}`,
    messages: [{ role: 'user', content: 'hi' }],
  };
}

/** A target that produces the given conversation successfully (the common case). */
function target(title: string): BulkTarget {
  return { title, produce: () => Promise.resolve(conversation(title)) };
}

const NOW = new Date(2026, 6, 17);

// A save spy plus a no-wait sleep spy, so the loop runs with no real downloads/timers.
function deps(save: (c: Conversation, f: ExportFormat, now: Date) => Promise<void>) {
  const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
  return { save: vi.fn(save), sleep };
}

describe('bulkExport', () => {
  it('produces and saves every target in order and reports an all-success summary', async () => {
    const saved: string[] = [];
    const { save, sleep } = deps((c) => {
      saved.push(c.title);
      return Promise.resolve();
    });
    const targets = [target('a'), target('b'), target('c')];

    const summary = await bulkExport(targets, 'md', NOW, { save, sleep });

    expect(saved).toEqual(['a', 'b', 'c']);
    expect(summary).toEqual({ total: 3, succeeded: 3, failed: [] });
    expect(save).toHaveBeenCalledWith(conversation('a'), 'md', NOW);
  });

  it('captures a mid-list SAVE failure and still exports the remaining targets', async () => {
    const saved: string[] = [];
    const { save, sleep } = deps((c) => {
      if (c.title === 'b') return Promise.reject(new Error('save failed'));
      saved.push(c.title);
      return Promise.resolve();
    });
    const targets = [target('a'), target('b'), target('c')];

    const summary = await bulkExport(targets, 'md', NOW, { save, sleep });

    expect(saved).toEqual(['a', 'c']); // b failed, c still ran
    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toEqual([{ title: 'b', error: 'save failed' }]);
  });

  it('captures a PRODUCE failure (e.g. navigation/extraction) and does not save that target', async () => {
    const saved: string[] = [];
    const { save, sleep } = deps((c) => {
      saved.push(c.title);
      return Promise.resolve();
    });
    const targets: BulkTarget[] = [
      target('a'),
      { title: 'b', produce: () => Promise.reject(new Error('extract failed')) },
      target('c'),
    ];

    const summary = await bulkExport(targets, 'md', NOW, { save, sleep });

    expect(saved).toEqual(['a', 'c']); // b never produced a conversation to save
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toEqual([{ title: 'b', error: 'extract failed' }]);
    // The failed target's produce is not paired with a save call.
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('stringifies a non-Error thrown value into the failure message', async () => {
    const { save, sleep } = deps(() => Promise.resolve());
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const targets: BulkTarget[] = [{ title: 'a', produce: () => Promise.reject('boom') }];
    const summary = await bulkExport(targets, 'md', NOW, { save, sleep });
    expect(summary.failed).toEqual([{ title: 'a', error: 'boom' }]);
  });

  it('reports progress at the start of each target (zero-based index, title, total)', async () => {
    const { save, sleep } = deps(() => Promise.resolve());
    const onProgress = vi.fn<(i: number, total: number, title: string) => void>();
    await bulkExport([target('a'), target('b')], 'md', NOW, { save, sleep, onProgress });
    expect(onProgress.mock.calls).toEqual([
      [0, 2, 'a'],
      [1, 2, 'b'],
    ]);
  });

  it('sleeps between targets only — n-1 times for n targets', async () => {
    const { save, sleep } = deps(() => Promise.resolve());
    await bulkExport([target('a'), target('b'), target('c')], 'md', NOW, { save, sleep });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not sleep after a single target', async () => {
    const { save, sleep } = deps(() => Promise.resolve());
    await bulkExport([target('a')], 'md', NOW, { save, sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('passes the configured delay to sleep', async () => {
    const { save, sleep } = deps(() => Promise.resolve());
    await bulkExport([target('a'), target('b')], 'md', NOW, { save, sleep, delayMs: 750 });
    expect(sleep).toHaveBeenCalledWith(750);
  });

  it('returns an empty summary and never saves or sleeps for no targets', async () => {
    const { save, sleep } = deps(() => Promise.resolve());
    const summary = await bulkExport([], 'pdf', NOW, { save, sleep });
    expect(summary).toEqual({ total: 0, succeeded: 0, failed: [] });
    expect(save).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});
