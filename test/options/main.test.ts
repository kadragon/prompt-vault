import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { DEFAULT_SETTINGS } from '../../src/settings/store';

// src/options/main.ts runs on import. Drive it over a happy-dom page and an in-memory
// chrome.storage.sync, and assert what the user sees and what lands in storage.
function bootPage(html: string, stored: unknown): { doc: Document; written: Record<string, unknown>[] } {
  const window = new Window();
  window.document.write(html);
  const doc = window.document as unknown as Document;
  const written: Record<string, unknown>[] = [];
  vi.stubGlobal('document', doc);
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  vi.stubGlobal('chrome', {
    ...g.chrome,
    storage: {
      sync: {
        get: () => (stored instanceof Error ? Promise.reject(stored) : Promise.resolve({ toolbarSettings: stored })),
        set: (items: Record<string, unknown>) => {
          written.push(items);
          return Promise.resolve();
        },
      },
    },
  });
  return { doc, written };
}

async function runEntry(): Promise<void> {
  vi.resetModules();
  await import('../../src/options/main');
}

afterEach(() => vi.unstubAllGlobals());

describe('options entry point', () => {
  it('renders the stored settings into #app', async () => {
    const stored = { formats: { md: false, pdf: true, json: true, html: true }, bulk: false };
    const { doc } = bootPage('<body><main id="app"></main></body>', stored);
    await runEntry();

    await vi.waitFor(() => expect(doc.getElementById('format-md')).not.toBeNull());
    expect((doc.getElementById('format-md') as HTMLInputElement).checked).toBe(false);
    expect((doc.getElementById('bulk') as HTMLInputElement).checked).toBe(false);
  });

  it('falls back to the defaults, still rendering the form, when the storage read fails', async () => {
    const { doc } = bootPage('<body><main id="app"></main></body>', new Error('storage down'));
    await runEntry();

    await vi.waitFor(() => expect(doc.getElementById('format-md')).not.toBeNull());
    expect((doc.getElementById('format-md') as HTMLInputElement).checked).toBe(true);
  });

  it('persists a change made in the form to chrome.storage.sync', async () => {
    const { doc, written } = bootPage('<body><main id="app"></main></body>', undefined);
    await runEntry();
    await vi.waitFor(() => expect(doc.getElementById('bulk')).not.toBeNull());

    const bulk = doc.getElementById('bulk') as HTMLInputElement;
    bulk.checked = false;
    bulk.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event('change'));

    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toEqual({ toolbarSettings: { ...DEFAULT_SETTINGS, bulk: false } });
  });

  it('does nothing, and does not throw, on a page without #app', async () => {
    const { doc } = bootPage('<body><main></main></body>', undefined);
    await runEntry();
    await Promise.resolve();
    expect(doc.getElementById('format-md')).toBeNull();
  });
});
