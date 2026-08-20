import { describe, expect, it } from 'vitest';
import { isCoachMarkDismissed, markCoachMarkDismissed, sanitizeDismissed } from '../../src/settings/onboarding';

// Same shape as test/settings/store.test.ts's helper, pointed at the `local` area (the coach-mark
// flag describes this browser's toolbar, so it does not roam).
const STORAGE_KEY = 'coachMarkDismissed';

function installStorageMock(seed: Record<string, unknown> = {}): Record<string, unknown> {
  const store: Record<string, unknown> = { ...seed };
  const local = {
    get(key: string): Promise<Record<string, unknown>> {
      return Promise.resolve(key in store ? { [key]: store[key] } : {});
    },
    set(items: Record<string, unknown>): Promise<void> {
      Object.assign(store, items);
      return Promise.resolve();
    },
  };
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  g.chrome = { ...g.chrome, storage: { local } };
  return store;
}

/** A storage area whose get/set both reject, standing in for a disabled/broken storage backend. */
function installFailingStorageMock(): void {
  const local = {
    get: (): Promise<Record<string, unknown>> => Promise.reject(new Error('storage unavailable')),
    set: (): Promise<void> => Promise.reject(new Error('storage unavailable')),
  };
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  g.chrome = { ...g.chrome, storage: { local } };
}

describe('sanitizeDismissed', () => {
  it('treats an absent or non-boolean value as not-yet-dismissed', () => {
    expect(sanitizeDismissed(undefined)).toBe(false);
    expect(sanitizeDismissed(null)).toBe(false);
    expect(sanitizeDismissed('true')).toBe(false);
    expect(sanitizeDismissed(1)).toBe(false);
    expect(sanitizeDismissed({})).toBe(false);
  });

  it('passes a real boolean through', () => {
    expect(sanitizeDismissed(true)).toBe(true);
    expect(sanitizeDismissed(false)).toBe(false);
  });
});

describe('isCoachMarkDismissed', () => {
  it('is false when nothing is stored yet (a fresh install still gets the card)', async () => {
    installStorageMock();
    await expect(isCoachMarkDismissed()).resolves.toBe(false);
  });

  it('is true once the flag is stored', async () => {
    installStorageMock({ [STORAGE_KEY]: true });
    await expect(isCoachMarkDismissed()).resolves.toBe(true);
  });

  it('resolves true (fail-safe: stay silent) when the storage read rejects', async () => {
    installFailingStorageMock();
    await expect(isCoachMarkDismissed()).resolves.toBe(true);
  });
});

describe('markCoachMarkDismissed', () => {
  it('persists the flag so a later read reports dismissed', async () => {
    const store = installStorageMock();
    await markCoachMarkDismissed();
    expect(store[STORAGE_KEY]).toBe(true);
    await expect(isCoachMarkDismissed()).resolves.toBe(true);
  });

  it('does not throw into the caller when the write rejects', async () => {
    installFailingStorageMock();
    await expect(markCoachMarkDismissed()).resolves.toBeUndefined();
  });
});
