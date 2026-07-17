import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  sanitize,
  saveSettings,
  subscribeSettings,
  type ToolbarSettings,
} from '../../src/settings/store';

// The chrome-i18n setup shim installs chrome.i18n but not chrome.storage; each test that
// touches storage installs a fresh in-memory mock that also drives onChanged, so we can
// exercise load/save/subscribe without a real browser.
type StorageChange = { oldValue?: unknown; newValue?: unknown };
type ChangeListener = (changes: Record<string, StorageChange>, area: string) => void;

function installStorageMock(): void {
  const store: Record<string, unknown> = {};
  const listeners = new Set<ChangeListener>();
  const sync = {
    get(key: string): Promise<Record<string, unknown>> {
      return Promise.resolve(key in store ? { [key]: store[key] } : {});
    },
    set(items: Record<string, unknown>): Promise<void> {
      const changes: Record<string, StorageChange> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: store[k], newValue: v };
        store[k] = v;
      }
      listeners.forEach((l) => l(changes, 'sync'));
      return Promise.resolve();
    },
  };
  const onChanged = {
    addListener: (l: ChangeListener): void => void listeners.add(l),
    removeListener: (l: ChangeListener): void => void listeners.delete(l),
  };
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  g.chrome = { ...g.chrome, storage: { sync, onChanged } };
}

describe('sanitize', () => {
  it('returns the all-on defaults for an absent/empty value', () => {
    expect(sanitize(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitize({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps explicitly-disabled formats disabled while defaulting the rest to on', () => {
    const result = sanitize({ formats: { md: false } });
    expect(result.formats).toEqual({ md: false, pdf: true, json: true, html: true });
    expect(result.bulk).toBe(true);
  });

  it('respects a disabled bulk toggle', () => {
    expect(sanitize({ bulk: false }).bulk).toBe(false);
  });

  it('falls back to all formats on when every format would be disabled (fail-safe)', () => {
    const result = sanitize({ formats: { md: false, pdf: false, json: false, html: false }, bulk: false });
    expect(result.formats).toEqual(DEFAULT_SETTINGS.formats);
    // The bulk toggle is independent of the format fail-safe.
    expect(result.bulk).toBe(false);
  });

  it('coerces non-boolean field values to the default', () => {
    const result = sanitize({ formats: { md: 'yes', pdf: 0 }, bulk: 'nope' });
    expect(result.formats.md).toBe(true);
    expect(result.formats.pdf).toBe(true);
    expect(result.bulk).toBe(true);
  });
});

describe('loadSettings / saveSettings', () => {
  it('returns defaults when nothing is stored', async () => {
    installStorageMock();
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a saved value', async () => {
    installStorageMock();
    const settings: ToolbarSettings = { formats: { md: true, pdf: false, json: false, html: false }, bulk: false };
    await saveSettings(settings);
    expect(await loadSettings()).toEqual(settings);
  });

  it('sanitizes on save so an all-off format set never persists', async () => {
    installStorageMock();
    await saveSettings({ formats: { md: false, pdf: false, json: false, html: false }, bulk: true });
    expect((await loadSettings()).formats).toEqual(DEFAULT_SETTINGS.formats);
  });
});

describe('subscribeSettings', () => {
  it('invokes the callback with the sanitized new value on a sync change, and unsubscribes', async () => {
    installStorageMock();
    const received: ToolbarSettings[] = [];
    const unsubscribe = subscribeSettings((s) => received.push(s));

    await saveSettings({ formats: { md: true, pdf: true, json: false, html: false }, bulk: false });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ formats: { md: true, pdf: true, json: false, html: false }, bulk: false });

    unsubscribe();
    await saveSettings(DEFAULT_SETTINGS);
    expect(received).toHaveLength(1);
  });
});
