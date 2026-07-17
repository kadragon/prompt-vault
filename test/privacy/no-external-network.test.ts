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
    } else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name)) {
      // Cover every JS/TS module flavor, not just .ts(x): a future non-TS file
      // in a guarded path must not slip a network call past the gate.
      files.push(abs);
    }
  }
  return files;
}

// Blank out comments and string/template literals (replacing their content with
// spaces, preserving newlines so line numbers stay accurate) before matching.
// This defeats two parser-differential evasions the naive per-line scan missed:
// a call split across lines (`fetch\n(`), which the FORBIDDEN patterns' `\s*`
// now spans over the preserved newlines; and a forbidden token that only looks
// like code but sits in a comment or string literal (a false positive we skip).
//
// Known limitation (accepted): template-literal `${...}` interpolation is blanked
// along with the surrounding literal, so a call inside it (`` `${fetch(x)}` ``) is
// NOT flagged. Descending into interpolation needs brace-nesting parsing — a
// semantic escape this static tripwire is deliberately not meant to resist (see
// the finding note in docs / the CodeQL data-flow option in backlog.md). Regex
// literals are treated as normal code, so a forbidden token inside one over-reports
// (safe direction).
function stripCommentsAndStrings(source: string): string {
  let out = '';
  let state: 'normal' | 'line' | 'block' | 'single' | 'double' | 'template' = 'normal';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    switch (state) {
      case 'normal':
        if (c === '/' && next === '/') { state = 'line'; out += '  '; i++; }
        else if (c === '/' && next === '*') { state = 'block'; out += '  '; i++; }
        else if (c === "'") { state = 'single'; out += ' '; }
        else if (c === '"') { state = 'double'; out += ' '; }
        else if (c === '`') { state = 'template'; out += ' '; }
        else out += c;
        break;
      case 'line':
        if (c === '\n') { state = 'normal'; out += '\n'; }
        else out += ' ';
        break;
      case 'block':
        if (c === '*' && next === '/') { state = 'normal'; out += '  '; i++; }
        else out += c === '\n' ? '\n' : ' ';
        break;
      case 'single':
      case 'double':
      case 'template':
        if (c === '\\') { out += ' '; out += next === '\n' ? '\n' : ' '; i++; }
        else if ((state === 'single' && c === "'") ||
                 (state === 'double' && c === '"') ||
                 (state === 'template' && c === '`')) { state = 'normal'; out += ' '; }
        else out += c === '\n' ? '\n' : ' ';
        break;
    }
  }
  return out;
}

// Scan one already-read source for forbidden primitives, returning `label:line — name`
// for each hit. Comments/strings are blanked first so only real code matches.
function scanForViolations(rawSource: string, label: string): string[] {
  const source = stripCommentsAndStrings(rawSource);
  const violations: string[] = [];
  for (const { name, pattern } of FORBIDDEN) {
    const re = new RegExp(pattern.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const lineNo = source.slice(0, m.index).split('\n').length;
      violations.push(`${label}:${lineNo} — ${name}`);
      if (m.index === re.lastIndex) re.lastIndex++; // guard against a zero-width match looping
    }
  }
  return violations;
}

describe('privacy invariant: no external-network primitives in adapter/export/content', () => {
  const files = SCAN_DIRS.flatMap((dir) => collectSourceFiles(join(REPO_ROOT, dir)));

  it('scans at least one source file', () => {
    // Guards against the gate silently passing because a path typo made it scan
    // nothing (e.g. src/ layout changed). src/content always has code.
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no fetch/XMLHttpRequest/sendBeacon calls', () => {
    const violations = files.flatMap((file) =>
      scanForViolations(readFileSync(file, 'utf8'), relative(REPO_ROOT, file)),
    );
    expect(violations, `external-network primitive(s) found:\n${violations.join('\n')}`).toEqual([]);
  });
});

describe('privacy gate detector: hardening against parser-differential evasion', () => {
  it('catches a call split across lines', () => {
    expect(scanForViolations('const x = fetch\n  (url);', 'f')).toEqual(['f:1 — fetch()']);
  });

  it('catches a token followed by a comment before the paren', () => {
    expect(scanForViolations('sendBeacon /* sneaky */ (data);', 'f')).toEqual(['f:1 — sendBeacon()']);
  });

  it('ignores a forbidden token inside a line comment', () => {
    expect(scanForViolations('// fetch(url) is documented here', 'f')).toEqual([]);
  });

  it('ignores a forbidden token inside a block comment', () => {
    expect(scanForViolations('/* example: XMLHttpRequest */\nconst ok = 1;', 'f')).toEqual([]);
  });

  it('ignores a forbidden token inside a string literal', () => {
    expect(scanForViolations('const s = "fetch(url)";', 'f')).toEqual([]);
  });

  it('ignores a forbidden token inside a template literal', () => {
    expect(scanForViolations('const s = `call fetch(x)`;', 'f')).toEqual([]);
  });

  it('reports the correct line number after preceding comments/strings', () => {
    const src = '// header\nconst s = "noise";\nfetch(url);';
    expect(scanForViolations(src, 'f')).toEqual(['f:3 — fetch()']);
  });

  it('still catches a real call adjacent to a string literal', () => {
    expect(scanForViolations('const u = "path"; fetch(u);', 'f')).toEqual(['f:1 — fetch()']);
  });
});
