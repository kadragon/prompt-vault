import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Golden principle #1 (local-only, no exfiltration) enforced mechanically:
// no external-network primitive may appear anywhere in the extension source.
// Downloads use URL.createObjectURL + <a download> (all local), so these tokens
// are never legitimately needed here. Any PR that adds one turns this gate red.
// See docs/conventions.md "Privacy invariant".
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The whole source tree, matching the invariant's own scope: a network call in
// src/core or src/settings exfiltrates just as effectively as one in an adapter.
const SCAN_DIRS = ['src'];

// Forbidden external-network primitives. Call-shaped for fetch/sendBeacon to
// avoid matching unrelated identifiers; bare token for XMLHttpRequest (its mere
// presence in these paths is the smell). navigator.sendBeacon is covered by the
// sendBeacon( pattern.
const FORBIDDEN: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'fetch()', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'sendBeacon()', pattern: /\bsendBeacon\s*\(/ },
];

// Cover every JS/TS module flavor, not just .ts(x): a future non-TS file in a
// guarded path must not slip a network call past the gate.
const SOURCE_FILE_RE = /\.(tsx?|jsx?|mjs|cjs)$/;

// The extension ships exactly one HTML file today (the options page), but the
// invariant is about the file type, not that one path.
const HTML_FILE_RE = /\.html?$/;

function collectFiles(absDir: string, match: RegExp): string[] {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    // Unreadable directory — scan nothing rather than throw. For the `src` root
    // itself that is caught loudly by the "scans at least one source file" guard
    // below, which is the renamed/moved-source-tree case. It does NOT cover a
    // recursive call: an unreadable SUBdirectory is skipped silently, because the
    // sibling directories still yield files and the guard passes. Pre-existing and
    // never observed; noted so the guard is not read as broader than it is.
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(abs, match));
    } else if (match.test(entry.name)) {
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

// The HTML half of the invariant. The collector above reads JS/TS only, so an
// inline `<script>` in the options page — the one place this extension ships HTML —
// would carry a fetch() straight past the gate. Rather than run the JS tokenizer over
// HTML (it mis-tokenizes apostrophes in prose and `<!-- -->` comments, over-reporting
// noisily), assert the narrower rule that is already true and already required: MV3's
// CSP forbids inline script in extension pages, so every `<script>` must load a `src=`
// module — and those modules are the .ts/.js files the scan above already covers.
// Together the two halves leave no file in `src/` unread.
//
// Deliberately narrow HTML matching, because the expected violation count is zero and
// what inaccuracy remains points the safe way: a `<script>` inside an `<!-- -->` comment
// is still flagged (over-report). Returns `label:line` per hit.
// True only if the tag's attribute text carries a real `src` attribute with a value.
// Walks attributes rather than substring-matching the blob: `src=` also occurs inside
// `data-src="…"` (a different attribute) and inside another attribute's quoted VALUE
// (`data-x="see src=a.js"`), and either read would let a genuine inline script through —
// the unsafe direction. Consuming each quoted value as one token settles both.
// A valueless `src` is not treated as a source, which over-reports (the safe way).
function hasSrcAttribute(attrs: string): boolean {
  const re = /([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
  let a: RegExpExecArray | null;
  while ((a = re.exec(attrs)) !== null) {
    if (a[1].toLowerCase() === 'src' && a[2] !== undefined) return true;
  }
  return false;
}

// Return a tag's attribute text — everything from `from` up to the tag-closing `>`.
// Quote-aware on purpose: a `>` inside a quoted value does not end the tag, and a
// `[^>]*` regex that assumes it does errs in the UNSAFE direction, not the safe one.
// It truncates mid-value, and the unterminated remainder re-tokenizes as a bare
// unquoted `src=…`, so `<script data-x="a src=b.js>" >fetch(u)</script>` reads as
// having a source — while a real parser builds an inline script that runs the fetch.
// Returns null when the tag never closes; a real parser drops such a tag entirely, and
// the caller flags it anyway (over-report, the safe way).
function readTagAttributes(html: string, from: number): string | null {
  let quote: '"' | "'" | null = null;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return html.slice(from, i);
    }
  }
  return null;
}

function findInlineScripts(rawHtml: string, label: string): string[] {
  const violations: string[] = [];
  const re = /<script\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawHtml)) !== null) {
    const attrs = readTagAttributes(rawHtml, re.lastIndex);
    if (attrs !== null && hasSrcAttribute(attrs)) continue;
    const lineNo = rawHtml.slice(0, m.index).split('\n').length;
    violations.push(`${label}:${lineNo} — inline <script>`);
  }
  return violations;
}

describe('privacy invariant: no external-network primitives anywhere in src/', () => {
  const files = SCAN_DIRS.flatMap((dir) => collectFiles(join(REPO_ROOT, dir), SOURCE_FILE_RE));

  it('scans at least one source file', () => {
    // Guards against the gate silently passing because a path typo made it scan
    // nothing (e.g. the source root was renamed). src/ always has code.
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no fetch/XMLHttpRequest/sendBeacon calls', () => {
    const violations = files.flatMap((file) =>
      scanForViolations(readFileSync(file, 'utf8'), relative(REPO_ROOT, file)),
    );
    expect(violations, `external-network primitive(s) found:\n${violations.join('\n')}`).toEqual([]);
  });
});

describe('privacy invariant: no inline <script> in src/ HTML', () => {
  const htmlFiles = SCAN_DIRS.flatMap((dir) => collectFiles(join(REPO_ROOT, dir), HTML_FILE_RE));

  it('scans at least one HTML file', () => {
    // Same renamed/moved-tree guard as the source scan: if the options page were
    // moved out of `src/`, this gate would pass by scanning nothing.
    expect(htmlFiles.length).toBeGreaterThan(0);
  });

  it('loads every script from a src= module', () => {
    const violations = htmlFiles.flatMap((file) =>
      findInlineScripts(readFileSync(file, 'utf8'), relative(REPO_ROOT, file)),
    );
    expect(
      violations,
      `inline <script> found (move the code to a module so the JS/TS scan covers it):\n${violations.join('\n')}`,
    ).toEqual([]);
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

describe('privacy gate detector: inline <script> in HTML', () => {
  it('flags a bare inline script', () => {
    expect(findInlineScripts('<body>\n<script>fetch(url)</script>\n</body>', 'h')).toEqual([
      'h:2 — inline <script>',
    ]);
  });

  it('flags an inline script that carries other attributes', () => {
    expect(findInlineScripts('<script type="module">fetch(url)</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
  });

  it('allows a script that loads a src= module', () => {
    expect(findInlineScripts('<script type="module" src="./main.ts"></script>', 'h')).toEqual([]);
  });

  it('allows src= written first, single-quoted, or spaced around the =', () => {
    expect(findInlineScripts("<script src = './a.js' defer></script>", 'h')).toEqual([]);
  });

  it('does not mistake a src-suffixed attribute name for src', () => {
    expect(findInlineScripts('<script data-src="x">code</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
    expect(findInlineScripts('<script data-srcset="x">code</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
  });

  it('does not mistake a src= substring inside another attribute value for src', () => {
    expect(findInlineScripts('<script data-x="see src=a.js">fetch(u)</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
    expect(findInlineScripts("<script title='src=b.js'>fetch(u)</script>", 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
  });

  it('does not let a > inside a quoted value truncate the tag into a fake src', () => {
    // Both build a real inline script in a browser parser (no src attribute, body runs).
    expect(findInlineScripts('<script data-x="pre src=oops.js> more" >fetch(u)</script>', 'h')).toEqual(
      ['h:1 — inline <script>'],
    );
    expect(findInlineScripts('<script data-x="a src=b.js>" >fetch(u)</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
  });

  it('flags a tag whose quote is never closed', () => {
    // A real parser drops the unterminated tag entirely, so nothing runs either way.
    expect(findInlineScripts('<script data-x="src=a.js>fetch(u)</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
  });

  it('flags a valueless src attribute', () => {
    // Loads nothing, so the body is still inline. Over-reporting, the safe way.
    expect(findInlineScripts('<script src>code</script>', 'h')).toEqual(['h:1 — inline <script>']);
  });

  it('allows an unquoted src value', () => {
    expect(findInlineScripts('<script src=./main.js defer></script>', 'h')).toEqual([]);
  });

  it('reports every inline script in a file', () => {
    const html = '<script>a</script>\n<script src="b.js"></script>\n<script>c</script>';
    expect(findInlineScripts(html, 'h')).toEqual(['h:1 — inline <script>', 'h:3 — inline <script>']);
  });
});
