import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Golden principle #1 (local-only, no exfiltration) enforced mechanically:
// no external-network primitive may appear anywhere under the adapter, export,
// or content paths. Downloads use URL.createObjectURL + <a download> (all
// local), so these tokens are never legitimately needed here. Any PR that adds
// one turns this gate red. See docs/conventions.md "Privacy invariant".
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Directories scanned. Some (adapters, export) do not exist yet — the gate must
// already cover them so the first code added there is checked from line one.
const SCAN_DIRS = ['src/adapters', 'src/export', 'src/content'];

// Forbidden external-network primitives. Call-shaped for fetch/sendBeacon to
// avoid matching unrelated identifiers; bare token for XMLHttpRequest (its mere
// presence in these paths is the smell). navigator.sendBeacon is covered by the
// sendBeacon( pattern.
const FORBIDDEN: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'fetch()', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'sendBeacon()', pattern: /\bsendBeacon\s*\(/ },
];

function collectSourceFiles(absDir: string): string[] {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    // Directory does not exist yet — nothing to scan, not a failure.
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(abs));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(abs);
    }
  }
  return files;
}

describe('privacy invariant: no external-network primitives in adapter/export/content', () => {
  const files = SCAN_DIRS.flatMap((dir) => collectSourceFiles(join(REPO_ROOT, dir)));

  it('scans at least one source file', () => {
    // Guards against the gate silently passing because a path typo made it scan
    // nothing (e.g. src/ layout changed). src/content always has code.
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no fetch/XMLHttpRequest/sendBeacon calls', () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const rel = relative(REPO_ROOT, file);
      source.split('\n').forEach((line, i) => {
        for (const { name, pattern } of FORBIDDEN) {
          if (pattern.test(line)) {
            violations.push(`${rel}:${i + 1} — ${name}`);
          }
        }
      });
    }
    expect(violations, `external-network primitive(s) found:\n${violations.join('\n')}`).toEqual([]);
  });
});
