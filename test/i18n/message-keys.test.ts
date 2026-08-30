import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// AGENTS.md #4 (fail loud) enforced mechanically for i18n: chrome.i18n.getMessage()
// returns "" (not a throw) for a missing/misspelled key, so a key typo in
// src/strings.ts would silently ship an empty button label or empty fail-loud
// message. This gate turns that class of typo into a red test: every key resolved
// through m('...') in src/strings.ts must exist in EVERY shipped locale catalog, each
// catalog must declare the same placeholder set per key as en (a placeholder mismatch
// breaks substitution in one language only), and no catalog may leave a translatable
// message sitting in English. See docs/conventions.md.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const STRINGS_PATH = join(REPO_ROOT, 'src', 'strings.ts');
const MANIFEST_PATH = join(REPO_ROOT, 'manifest.config.ts');
const LOCALES_DIR = join(REPO_ROOT, 'public', '_locales');
// Enumerated, not hardcoded: a new locale directory is gated the moment it is added,
// which is the only thing standing between a half-translated catalog and a Chrome Web
// Store listing that claims to support that language. `en` is the default_locale and
// therefore the reference every other catalog is compared against.
const REFERENCE_LOCALE = 'en';

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

// The manifest resolves its own strings through `__MSG_key__` substitution, never through
// m(), so scanning src/strings.ts alone leaves appName/appDesc ungated — and those are the
// two strings a Web Store visitor reads in their own language. A locale that copied the
// English appDesc would have passed green and shipped an English store description under a
// native listing.
function extractManifestKeys(source: string): string[] {
  return [...new Set([...source.matchAll(/__MSG_(\w+)__/g)].map((match) => match[1]))];
}

function placeholderKeys(entry: MessageEntry | undefined): string[] {
  return Object.keys(entry?.placeholders ?? {}).sort();
}

const manifestKeys = extractManifestKeys(readFileSync(MANIFEST_PATH, 'utf8'));
const referencedKeys = [
  ...new Set([...extractReferencedKeys(readFileSync(STRINGS_PATH, 'utf8')), ...manifestKeys]),
];
const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const catalogs = new Map<string, Record<string, MessageEntry>>(
  locales.map((locale) => [locale, loadCatalog(join(LOCALES_DIR, locale, 'messages.json'))]),
);
const reference = catalogs.get(REFERENCE_LOCALE)!;
const localeKeyPairs = locales.flatMap((locale) =>
  referencedKeys.map((key) => [locale, key] as const),
);

describe('i18n message-key safety', () => {
  it('finds referenced keys in src/strings.ts (guard against a broken scan)', () => {
    expect(referencedKeys.length).toBeGreaterThan(0);
  });

  it('finds the manifest __MSG_ keys (guard against a broken scan)', () => {
    expect(manifestKeys).toEqual(expect.arrayContaining(['appName', 'appDesc']));
  });

  it('discovers the shipped locale catalogs, including the default_locale', () => {
    expect(locales).toContain(REFERENCE_LOCALE);
    expect(locales.length).toBeGreaterThan(1);
  });

  it.each(localeKeyPairs)('%s catalog defines key "%s"', (locale, key) => {
    expect(catalogs.get(locale), `missing "${key}" in ${locale}/messages.json`).toHaveProperty(key);
  });

  it.each(localeKeyPairs)('%s key "%s" matches the en placeholder set', (locale, key) => {
    expect(placeholderKeys(catalogs.get(locale)![key])).toEqual(placeholderKeys(reference[key]));
  });

  // A catalog that copies the English message verbatim ships an untranslated string to a
  // user whose listing promised their language. Labels that are the same in every language
  // (format names, file extensions) are the legitimate exception.
  const UNTRANSLATED_ALLOWED = new Set([
    'downloadMdLabel',
    'downloadPdfLabel',
    'downloadJsonLabel',
    'downloadHtmlLabel',
  ]);

  it.each(locales.filter((locale) => locale !== REFERENCE_LOCALE))(
    '%s catalog translates every message that is not language-neutral',
    (locale) => {
      const copied = referencedKeys.filter(
        (key) =>
          !UNTRANSLATED_ALLOWED.has(key) &&
          catalogs.get(locale)![key]?.message === reference[key]?.message,
      );
      expect(copied, `${locale} left these keys in English`).toEqual([]);
    },
  );
});
