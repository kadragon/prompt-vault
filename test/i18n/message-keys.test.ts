import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// AGENTS.md #4 (fail loud) enforced mechanically for i18n: chrome.i18n.getMessage()
// returns "" (not a throw) for a missing/misspelled key, so a key typo in
// src/strings.ts would silently ship an empty button label or empty fail-loud
// message. This gate turns that class of typo into a red test: every key resolved
// through m('...') in src/strings.ts must exist in BOTH locale catalogs, and the
// two catalogs must declare identical placeholder sets per key (a placeholder
// mismatch breaks substitution in one language only). See docs/conventions.md.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const STRINGS_PATH = join(REPO_ROOT, 'src', 'strings.ts');
const EN_PATH = join(REPO_ROOT, 'public', '_locales', 'en', 'messages.json');
const KO_PATH = join(REPO_ROOT, 'public', '_locales', 'ko', 'messages.json');

interface MessageEntry {
  message: string;
  description?: string;
  placeholders?: Record<string, unknown>;
}

function loadCatalog(path: string): Record<string, MessageEntry> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, MessageEntry>;
}

// Extract every key passed to the m('key', ...) helper in src/strings.ts. The
// helper is the single choke point through which strings resolve, so scanning
// its call sites captures exactly the keys the UI depends on at runtime.
function extractReferencedKeys(source: string): string[] {
  const keys = new Set<string>();
  const pattern = /\bm\(\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    keys.add(match[1]);
  }
  return [...keys];
}

function placeholderKeys(entry: MessageEntry | undefined): string[] {
  return Object.keys(entry?.placeholders ?? {}).sort();
}

const referencedKeys = extractReferencedKeys(readFileSync(STRINGS_PATH, 'utf8'));
const en = loadCatalog(EN_PATH);
const ko = loadCatalog(KO_PATH);

describe('i18n message-key safety', () => {
  it('finds referenced keys in src/strings.ts (guard against a broken scan)', () => {
    expect(referencedKeys.length).toBeGreaterThan(0);
  });

  it.each(referencedKeys)('key "%s" exists in the en catalog', (key) => {
    expect(en, `missing "${key}" in en/messages.json`).toHaveProperty(key);
  });

  it.each(referencedKeys)('key "%s" exists in the ko catalog', (key) => {
    expect(ko, `missing "${key}" in ko/messages.json`).toHaveProperty(key);
  });

  it.each(referencedKeys)('key "%s" declares matching placeholder sets across catalogs', (key) => {
    expect(placeholderKeys(ko[key])).toEqual(placeholderKeys(en[key]));
  });
});
