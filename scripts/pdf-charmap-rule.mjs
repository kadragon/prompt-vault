// The derivation rule for the PDF character fallback table, shared by the generator
// (scripts/gen-pdf-charmap.mjs) and the test that re-derives it
// (test/export/pdf-charmap.test.ts). Keeping the rule in one place is what makes the
// committed table mechanically checkable: if the embedded font changes, the test
// re-runs this rule against the new font files and fails on any drift.
//
// The rule: for every code point in the scanned ranges that BOTH embedded faces lack
// a glyph for, take its Unicode NFKC form; keep the substitution only when that form
// differs from the original AND every one of its code points is covered by both
// faces. Anything else is left alone — a partial substitution would trade one tofu
// box for another, and rewriting a character the font can already draw would be a
// regression, not a fix.

/**
 * Code point ranges scanned for missing-but-substitutable characters. Deliberately
 * bounded: these are the blocks whose characters realistically appear in chat prose
 * (punctuation, currency, letterlike/number forms, enclosed and squared CJK forms,
 * fullwidth forms). Scanning the whole BMP would drag in thousands of presentation
 * forms nobody types into a chat.
 */
export const FALLBACK_SCAN_RANGES = [
  [0x2000, 0x206f], // General Punctuation
  [0x2070, 0x209f], // Super/Subscripts
  [0x20a0, 0x20bf], // Currency Symbols
  [0x2100, 0x214f], // Letterlike Symbols (℃, ℉, ™, №)
  [0x2150, 0x218f], // Number Forms (Ⅰ, ⅓)
  [0x2460, 0x24ff], // Enclosed Alphanumerics (①, ⓐ)
  [0x3000, 0x303f], // CJK Symbols and Punctuation
  [0x3200, 0x32ff], // Enclosed CJK Letters and Months (㈜, ㊙)
  [0x3300, 0x33ff], // CJK Compatibility (㎏, ㎡, ㎝)
  [0xff00, 0xffef], // Halfwidth and Fullwidth Forms
];

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
      const replacement = char.normalize('NFKC');
      if (replacement === char) continue;
      if (![...replacement].every((c) => hasGlyph(c.codePointAt(0)))) continue;
      table[char] = replacement;
    }
  }
  return table;
}
