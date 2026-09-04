// The derivation rule for the PDF character fallback table, shared by the generator
// (scripts/gen-pdf-charmap.mjs) and the test that re-derives it
// (test/export/pdf-charmap.test.ts). Keeping the rule in one place is what makes the
// committed table mechanically checkable: if the embedded font changes, the test
// re-runs this rule against the new font files and fails on any drift.
//
// The rule: for every code point in the scanned ranges that BOTH embedded faces lack
// a glyph for, take its Unicode NFKC form, fold the typographic characters that have a
// plain ASCII equivalent, and keep the substitution only when the result differs from
// the original AND every one of its code points is covered by both faces. Anything else is left alone — a partial
// substitution would trade one tofu box for another, and rewriting a character the
// font can already draw would be a regression, not a fix.

/**
 * @internal Code point ranges scanned for missing-but-substitutable characters. The scan is
 * deliberately wide — everything from the first printable character through the
 * Supplementary Multilingual Plane — because the rule below is self-limiting: a code
 * point is only added when the font cannot draw it AND can draw its NFKC form, so
 * scanning more blocks can never rewrite a character that already renders. Narrowing
 * the scan by hand only creates blind spots; the earlier hand-picked block list missed
 * the Mathematical Alphanumeric Symbols (U+1D400–1D7FF) that chat models emit as
 * pseudo-bold prose, so `𝐍𝐨𝐭𝐞` exported as four tofu boxes.
 *
 * Surrogate code points are skipped: they are not characters, and String.fromCodePoint
 * would produce a lone surrogate that no normalization can act on.
 */
const SCAN_RANGES = [
  [0x0020, 0xd7ff],
  [0xe000, 0xffff],
  [0x10000, 0x1ffff],
];

// NFKC reaches for typographic punctuation that has a plain ASCII equivalent: `㎧`
// becomes `m∕s` (U+2215 DIVISION SLASH), `⅜` becomes `3⁄8` (U+2044 FRACTION SLASH),
// `‑` becomes `‐` (U+2010 HYPHEN), `⁻` becomes `−` (U+2212 MINUS SIGN). Every one
// renders, but the point of substituting at all is text the reader can search, copy and
// paste: `m∕s` does not match a Ctrl-F for `m/s` and `ABC‐123` does not match
// `ABC-123`, and neither survives a paste into code or a shell. Fold them before the
// coverage check.
//
// Deliberately NOT folded: characters whose ASCII spelling would lose meaning rather
// than restore it — en and em dashes (real punctuation, not a stand-in for `-`), and
// every letter, bracket and symbol from another script (Greek, Cyrillic, Hangul, CJK
// brackets, `°`, `Ω`). test/export/pdf-charmap.test.ts pins the full set of non-ASCII
// characters that survive, so a font swap that introduces a new one forces this
// judgement to be made again rather than shipping silently.
const ASCII_EQUIVALENTS = [
  [/[\u2215\u2044]/g, '/'], // division slash, fraction slash
  [/[\u2010\u2011\u2012\u2212]/g, '-'], // hyphen, non-breaking hyphen, figure dash, minus
  [/\u2032/g, "'"], // prime
  [/\u2033/g, '"'], // double prime
];

/** Fold every typographic character that has a plain ASCII equivalent. */
function foldToAscii(text) {
  return ASCII_EQUIVALENTS.reduce((acc, [pattern, ascii]) => acc.replace(pattern, ascii), text);
}

/**
 * Derive the NFKC-based fallback table.
 *
 * @param {(codePoint: number) => boolean} hasGlyph true when EVERY embedded face can
 *   draw the code point. Both faces must be checked: a run the Markdown renderer
 *   marks bold is laid out with the Bold file, so a glyph only Regular carries would
 *   still render as tofu in `**strong**` text.
 * @returns {Record<string, string>} original character → replacement, insertion-ordered
 *   by code point so the generated file is deterministic.
 */
export function deriveNfkcFallbacks(hasGlyph) {
  /** @type {Record<string, string>} */
  const table = {};
  for (const [start, end] of SCAN_RANGES) {
    for (let cp = start; cp <= end; cp++) {
      if (hasGlyph(cp)) continue;
      const char = String.fromCodePoint(cp);
      const replacement = foldToAscii(char.normalize('NFKC'));
      if (replacement === char) continue;
      if (![...replacement].every((c) => hasGlyph(c.codePointAt(0)))) continue;
      table[char] = replacement;
    }
  }
  return table;
}

/**
 * Derive the code-point ranges BOTH embedded faces can draw, as sorted, inclusive
 * `[start, end]` pairs. This is the complement of the fallback table above: the table
 * says what to rewrite, this says what is left that still cannot be drawn — the
 * characters that reach the PDF as tofu boxes, which the exporter has to warn about
 * (AGENTS.md #4).
 *
 * Both faces, intersected, for the reason the fallback rule uses both: a bold Markdown
 * run is laid out with the Bold file, so a glyph only one face carries still boxes in
 * `**strong**` text.
 *
 * @param {ReadonlyArray<Iterable<number>>} characterSets one code-point set per face
 * @returns {Array<[number, number]>}
 */
export function deriveCoverageRanges(characterSets) {
  const sets = characterSets.map((set) => new Set(set));
  const covered = [...sets[0]].filter((cp) => sets.every((set) => set.has(cp))).sort((a, b) => a - b);
  /** @type {Array<[number, number]>} */
  const ranges = [];
  for (const cp of covered) {
    const last = ranges[ranges.length - 1];
    if (last && cp === last[1] + 1) last[1] = cp;
    else ranges.push([cp, cp]);
  }
  return ranges;
}
