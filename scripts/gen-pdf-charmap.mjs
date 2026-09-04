// Regenerate src/export/pdf-charmap-generated.ts and src/export/pdf-coverage-generated.ts
// from the embedded font files.
// Run after replacing either Jetendard face:
//
//   node scripts/gen-pdf-charmap.mjs
//
// test/export/pdf-charmap.test.ts re-derives the same table and fails if the
// committed file drifts, so this script is a convenience, not a trust boundary.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveCoverageRanges, deriveNfkcFallbacks } from './pdf-charmap-rule.mjs';

const require = createRequire(import.meta.url);
const fontkit = require('fontkit');

const FACES = ['Jetendard-Regular.ttf', 'Jetendard-Bold.ttf'].map((name) =>
  fontkit.openSync(fileURLToPath(new URL(`../public/fonts/${name}`, import.meta.url))),
);
const hasGlyph = (cp) => FACES.every((face) => face.hasGlyphForCodePoint(cp));

const table = deriveNfkcFallbacks(hasGlyph);

const escape = (text) =>
  [...text]
    .map((c) => {
      const cp = c.codePointAt(0);
      if (cp === 0x27) return "\\'";
      if (cp === 0x5c) return '\\\\';
      if (cp > 0x20 && cp < 0x7f) return c;
      return `\\u{${cp.toString(16).toUpperCase()}}`;
    })
    .join('');

const entries = Object.entries(table)
  .map(([from, to]) => `  '${escape(from)}': '${escape(to)}', // ${from.codePointAt(0) > 0x20 ? from : ''} U+${from.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} → ${JSON.stringify(to)}`)
  .join('\n');

const source = `// GENERATED FILE — do not edit by hand.
// Produced by scripts/gen-pdf-charmap.mjs from the two embedded Jetendard faces;
// the derivation rule lives in scripts/pdf-charmap-rule.mjs and is re-run by
// test/export/pdf-charmap.test.ts, which fails if this file drifts from the fonts.
//
// Each key is a character neither embedded face can draw (it would render as a tofu
// box in the exported PDF); each value is its Unicode NFKC form, which both faces can.

/** Missing character → NFKC replacement, derived from the embedded font files. */
export const NFKC_FALLBACKS: Readonly<Record<string, string>> = {
${entries}
};
`;

const out = fileURLToPath(new URL('../src/export/pdf-charmap-generated.ts', import.meta.url));
writeFileSync(out, source);
console.log(`wrote ${Object.keys(table).length} fallbacks to ${out}`);

const ranges = deriveCoverageRanges(FACES.map((face) => face.characterSet));
const hex = (cp) => `0x${cp.toString(16).toUpperCase().padStart(4, '0')}`;
const coverageSource = `// GENERATED FILE — do not edit by hand.
// Produced by scripts/gen-pdf-charmap.mjs from the two embedded Jetendard faces;
// the derivation rule lives in scripts/pdf-charmap-rule.mjs and is re-run by
// test/export/pdf-charmap.test.ts, which fails if this file drifts from the fonts.
//
// Inclusive [start, end] code-point ranges BOTH faces can draw, ascending and
// non-adjacent. Everything outside them exports as a tofu box; ./pdf-charmap.ts
// rewrites the subset that has a drawable NFKC form, and what survives that is what
// src/export/pdf.ts warns the user about.

/** Code-point ranges covered by both embedded faces, ascending. */
export const COVERED_RANGES: ReadonlyArray<readonly [number, number]> = [
${ranges.map(([start, end]) => `  [${hex(start)}, ${hex(end)}],`).join('\n')}
];
`;
const coverageOut = fileURLToPath(
  new URL('../src/export/pdf-coverage-generated.ts', import.meta.url),
);
writeFileSync(coverageOut, coverageSource);
console.log(`wrote ${ranges.length} covered ranges to ${coverageOut}`);
