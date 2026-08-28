// Character fallbacks for the PDF exporter.
//
// The embedded Jetendard faces cover Latin, Hangul and common symbols, but not the
// CJK compatibility and letterlike blocks — `℃`, `㎏`, `㈜`, `Ⅰ` and friends have no
// glyph, so pdfmake draws a tofu box and a Korean conversation about, say, a fridge
// temperature exports as `-1.0□`. Replacing the font is the only way to draw those
// shapes; short of that, substituting each one for a spelling the font CAN draw keeps
// the text readable and copy-pasteable.
//
// Two tables feed the substitution:
//   - NFKC_FALLBACKS — generated from the font files themselves (see
//     ./pdf-charmap-generated.ts and scripts/pdf-charmap-rule.mjs). Every missing
//     character whose Unicode NFKC form the font can draw, with no hand-picking.
//   - CURATED_FALLBACKS below — the handful of missing characters Unicode gives no
//     decomposition for, so a human has to choose the stand-in.
//
// Substitution runs on the built document nodes, never on the Markdown source: a
// replacement that introduces `*` must not be able to turn into emphasis.

import { NFKC_FALLBACKS } from './pdf-charmap-generated';

/**
 * Missing characters with no Unicode decomposition, mapped by hand. Every value here
 * is asserted glyph-covered by test/export/pdf-charmap.test.ts, so a stand-in that is
 * itself missing fails the build rather than shipping a different tofu box.
 */
export const CURATED_FALLBACKS: Readonly<Record<string, string>> = {
  '※': '*', // ※ reference mark — opens a Korean footnote the way `*` does
  '★': '●', // ★ → ● filled circle keeps "filled" against its hollow twin
  '☆': '○', // ☆ → ○
  '‒': '-', // ‒ figure dash
  '―': '—', // ― horizontal bar → em dash
  '‣': '▪', // ‣ triangular bullet → small black square
  '⁃': '-', // ⁃ hyphen bullet
  '‧': '·', // ‧ hyphenation point → middle dot
  '☑': '[v]', // ☑ checked box
  '☒': '[x]', // ☒ crossed box
  '✔': '✓', // ✔ heavy check → check
  '✘': '✗', // ✘ heavy ballot X → ballot X
};

/** Every substitution the exporter applies: generated table plus the curated ones. */
export const PDF_CHAR_FALLBACKS: Readonly<Record<string, string>> = {
  ...NFKC_FALLBACKS,
  ...CURATED_FALLBACKS,
};

// A character class of every key, built once. Keys are single code points, so each is
// emitted as a `\u{...}` escape rather than pasted raw — several are invisible spaces
// or format characters that would be unreadable (and easy to mangle) inline.
const FALLBACK_PATTERN = new RegExp(
  `[${Object.keys(PDF_CHAR_FALLBACKS)
    .map((char) => `\\u{${char.codePointAt(0)?.toString(16)}}`)
    .join('')}]`,
  'gu',
);

/**
 * Replace every character the embedded font cannot draw with a covered equivalent.
 * A string containing none of them is returned unchanged.
 */
export function substituteUnsupportedChars(text: string): string {
  return text.replace(FALLBACK_PATTERN, (char) => PDF_CHAR_FALLBACKS[char]);
}
