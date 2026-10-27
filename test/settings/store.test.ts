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

  it('shows the share icon by default and respects a disabled share toggle', () => {
    expect(DEFAULT_SETTINGS.share).toBe(true);
    expect(sanitize({ formats: { md: true }, bulk: false }).share).toBe(true);
    expect(sanitize({ share: false }).share).toBe(false);
  });

  it('repairs a non-boolean share value to the default', () => {
    expect(sanitize({ share: 'off' }).share).toBe(true);
    expect(sanitize({ share: 0 }).share).toBe(true);
  });

  it('falls back to all formats on when every format would be disabled (fail-safe)', () => {
    const result = sanitize({ formats: { md: false, pdf: false, json: false, html: false }, bulk: false, share: true });
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
    const settings: ToolbarSettings = { formats: { md: true, pdf: false, json: false, html: false }, bulk: false, share: true };
    await saveSettings(settings);
    expect(await loadSettings()).toEqual(settings);
  });

  it('sanitizes on save so an all-off format set never persists', async () => {
    installStorageMock();
    await saveSettings({ formats: { md: false, pdf: false, json: false, html: false }, bulk: true, share: true });
    expect((await loadSettings()).formats).toEqual(DEFAULT_SETTINGS.formats);
  });
});

describe('storage key stability', () => {
  // A renamed key would silently reset every user's saved settings, so the literal is pinned.
  it('persists under, reads from, and listens on the "toolbarSettings" key', async () => {
    const written: Record<string, unknown>[] = [];
    const requested: unknown[] = [];
    let listener: ChangeListener | undefined;
    const stored = { formats: { md: false, pdf: true, json: true, html: true }, bulk: false, share: true };
    const g = globalThis as unknown as { chrome: Record<string, unknown> };
    g.chrome = {
      ...g.chrome,
      storage: {
        sync: {
          get: (key: unknown): Promise<Record<string, unknown>> => {
            requested.push(key);
            return Promise.resolve({ toolbarSettings: stored });
          },
          set: (items: Record<string, unknown>): Promise<void> => {
            written.push(items);
            return Promise.resolve();
          },
        },
        onChanged: {
          addListener: (l: ChangeListener): void => void (listener = l),
          removeListener: (): void => undefined,
        },
      },
    };

    await saveSettings(DEFAULT_SETTINGS);
    expect(Object.keys(written[0])).toEqual(['toolbarSettings']);

    expect(await loadSettings()).toEqual(stored);
    expect(requested).toEqual(['toolbarSettings']);

    const received: ToolbarSettings[] = [];
    subscribeSettings((s) => received.push(s));
    listener!({ toolbarSettings: { newValue: stored } }, 'sync');
    expect(received).toEqual([stored]);
  });
});

describe('subscribeSettings', () => {
  it('invokes the callback with the sanitized new value on a sync change, and unsubscribes', async () => {
    installStorageMock();
    const received: ToolbarSettings[] = [];
    const unsubscribe = subscribeSettings((s) => received.push(s));

    await saveSettings({ formats: { md: true, pdf: true, json: false, html: false }, bulk: false, share: true });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ formats: { md: true, pdf: true, json: false, html: false }, bulk: false, share: true });

    unsubscribe();
    await saveSettings(DEFAULT_SETTINGS);
    expect(received).toHaveLength(1);
  });
});
