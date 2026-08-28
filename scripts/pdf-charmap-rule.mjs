// The derivation rule for the PDF character fallback table, shared by the generator
// (scripts/gen-pdf-charmap.mjs) and the test that re-derives it
// (test/export/pdf-charmap.test.ts). Keeping the rule in one place is what makes the
// committed table mechanically checkable: if the embedded font changes, the test
// re-runs this rule against the new font files and fails on any drift.
//
// The rule: for every code point in the scanned ranges that BOTH embedded faces lack
// a glyph for, take its Unicode NFKC form, fold its typographic slashes to ASCII, and
// keep the substitution only when the result differs from the original AND every one
// of its code points is covered by both faces. Anything else is left alone — a partial
// substitution would trade one tofu box for another, and rewriting a character the
// font can already draw would be a regression, not a fix.

/**
 * Code point ranges scanned for missing-but-substitutable characters. The scan is
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
export const FALLBACK_SCAN_RANGES = [
  [0x0020, 0xd7ff],
  [0xe000, 0xffff],
  [0x10000, 0x1ffff],
];

// NFKC spells several compatibility characters with a typographic slash — `㎧` becomes
// `m∕s` (U+2215 DIVISION SLASH) and `⅜` becomes `3⁄8` (U+2044 FRACTION SLASH). Both
// render, but the point of substituting at all is text the reader can search, copy and
// paste: `m∕s` does not match a Ctrl-F for `m/s`, and pasting it into code or a shell
// fails. Fold them to ASCII before the coverage check.
const TYPOGRAPHIC_SLASHES = /[\u2215\u2044]/g;

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
  for (const [start, end] of FALLBACK_SCAN_RANGES) {
    for (let cp = start; cp <= end; cp++) {
      if (hasGlyph(cp)) continue;
      const char = String.fromCodePoint(cp);
      const replacement = char.normalize('NFKC').replace(TYPOGRAPHIC_SLASHES, '/');
      if (replacement === char) continue;
      if (![...replacement].every((c) => hasGlyph(c.codePointAt(0)))) continue;
      table[char] = replacement;
    }
  }
  return table;
}
