// User settings for which export controls appear in the header toolbar. Persisted in
// chrome.storage.sync (roams across the user's signed-in browsers) and read by both the
// content script (to filter the toolbar) and the options page (to render/save the form).
// Provider-agnostic: knows nothing about ChatGPT's DOM — only the export-format union.
//
// Default is "everything on" so an unconfigured install behaves exactly like before this
// feature shipped (backward compatible), and so a malformed/partial stored value degrades
// to a full toolbar rather than a blank one (fail-safe, AGENTS.md #4).

import type { ExportFormat } from '../content/save-conversation';

/** Which single-export format icons show in the toolbar, and whether the bulk icon shows. */
export interface ToolbarSettings {
  formats: Record<ExportFormat, boolean>;
  bulk: boolean;
}

// The single-export formats, in the same display order as the toolbar (src/content/mount.ts).
// Also the iteration source for sanitize, so a new format is added in exactly one place.
export const FORMAT_KEYS: ReadonlyArray<ExportFormat> = ['md', 'pdf', 'json', 'html'];

/** Everything visible — the pre-feature toolbar. Used as the default and the fail-safe. */
export const DEFAULT_SETTINGS: ToolbarSettings = {
  formats: { md: true, pdf: true, json: true, html: true },
  bulk: true,
};

// Storage key under which the settings object lives in chrome.storage.sync.
const STORAGE_KEY = 'toolbarSettings';

/**
 * Coerce an arbitrary stored/loaded value into a valid `ToolbarSettings`. Missing or
 * non-boolean fields fall back to the default (which is `true` for every field), and if the
 * result would hide every single-export format, the formats are reset to all-on so the
 * toolbar is never left with no way to export the current conversation (fail-safe).
 */
export function sanitize(raw: unknown): ToolbarSettings {
  const obj = (raw ?? {}) as Partial<{ formats: Partial<Record<ExportFormat, unknown>>; bulk: unknown }>;
  const rawFormats = obj.formats ?? {};
  const formats = {} as Record<ExportFormat, boolean>;
  for (const key of FORMAT_KEYS) {
    formats[key] = typeof rawFormats[key] === 'boolean' ? rawFormats[key] : DEFAULT_SETTINGS.formats[key];
  }
  // Never persist/return an all-off format set: that would strip every single-export button.
  if (!FORMAT_KEYS.some((key) => formats[key])) {
    Object.assign(formats, DEFAULT_SETTINGS.formats);
  }
  const bulk = typeof obj.bulk === 'boolean' ? obj.bulk : DEFAULT_SETTINGS.bulk;
  return { formats, bulk };
}

/** Read and sanitize the persisted settings. Returns defaults when nothing is stored yet. */
export async function loadSettings(): Promise<ToolbarSettings> {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return sanitize(stored[STORAGE_KEY]);
}

/** Persist `settings` (sanitized first, so callers cannot write an invalid shape). */
export async function saveSettings(settings: ToolbarSettings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: sanitize(settings) });
}

/**
 * Invoke `callback` with the new settings whenever they change in chrome.storage.sync
 * (e.g. the options page saves in another tab). Returns an unsubscribe function.
 */
export function subscribeSettings(callback: (settings: ToolbarSettings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'sync') return;
    const change = changes[STORAGE_KEY];
    if (!change) return;
    callback(sanitize(change.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
