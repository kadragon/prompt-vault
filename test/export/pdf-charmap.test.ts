import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  CURATED_FALLBACKS,
  PDF_CHAR_FALLBACKS,
  substituteUnsupportedChars,
} from '../../src/export/pdf-charmap';
import { NFKC_FALLBACKS } from '../../src/export/pdf-charmap-generated';
import { deriveNfkcFallbacks } from '../../scripts/pdf-charmap-rule.mjs';

// fontkit ships no type declarations, so it is required untyped and narrowed here.
// It is the same shaper pdfkit (and therefore pdfmake) uses, so asking it which code
// points the embedded files can draw is the same question the PDF renderer asks.
interface FontkitFont {
  hasGlyphForCodePoint(codePoint: number): boolean;
  layout(text: string, features?: unknown): { glyphs: Array<{ id: number; name: string }> };
}
const fontkit = createRequire(import.meta.url)('fontkit') as {
  openSync(path: string): FontkitFont;
};
const FACES = ['Jetendard-Regular.ttf', 'Jetendard-Bold.ttf'].map((name) =>
  fontkit.openSync(fileURLToPath(new URL(`../../src/export/fonts/${name}`, import.meta.url))),
);
// Both faces, not just Regular: a bold Markdown run is laid out with the Bold file,
// so a glyph only one face carries still exports as a tofu box in `**strong**` text.
const hasGlyph = (codePoint: number): boolean =>
  FACES.every((face) => face.hasGlyphForCodePoint(codePoint));
const covers = (text: string): boolean =>
  [...text].every((char) => hasGlyph(char.codePointAt(0) as number));

describe('the PDF fallback table', () => {
  it('only maps characters the embedded font actually lacks', () => {
    const spurious = Object.keys(PDF_CHAR_FALLBACKS).filter((char) =>
      hasGlyph(char.codePointAt(0) as number),
    );
    expect(spurious).toEqual([]);
  });

  it('maps every character to a replacement both faces can draw', () => {
    const stillMissing = Object.entries(PDF_CHAR_FALLBACKS)
      .filter(([, replacement]) => !covers(replacement))
      .map(([from, to]) => `${from} -> ${to}`);
    expect(stillMissing).toEqual([]);
  });

  it('never maps a character to itself', () => {
    const identity = Object.entries(PDF_CHAR_FALLBACKS).filter(([from, to]) => from === to);
    expect(identity).toEqual([]);
  });

  it('matches the generated table re-derived from the current font files', () => {
    // The guard against silent drift: swap in a font with different coverage and the
    // committed table stops matching what the rule produces from it.
    expect(NFKC_FALLBACKS).toEqual(deriveNfkcFallbacks(hasGlyph));
  });

  it('curates only characters Unicode gives no usable decomposition for', () => {
    const decomposable = Object.keys(CURATED_FALLBACKS).filter((char) => {
      const nfkc = char.normalize('NFKC');
      return nfkc !== char && covers(nfkc);
    });
    expect(decomposable).toEqual([]);
  });
});

describe('substituteUnsupportedChars', () => {
  it('rewrites the degree-Celsius sign that broke Korean exports', () => {
    expect(substituteUnsupportedChars('맛지킴김치 약 -1.0℃')).toBe('맛지킴김치 약 -1.0°C');
  });

  it('rewrites squared units, enclosed forms and roman numerals', () => {
    expect(substituteUnsupportedChars('5㎏ ㈜한글 Ⅲ ①')).toBe('5kg (주)한글 III 1');
  });

  it('rewrites curated characters with no decomposition', () => {
    expect(substituteUnsupportedChars('※ 참고 ★ ☑')).toBe('* 참고 ● [v]');
  });

  it('leaves text the font already covers untouched', () => {
    const covered = 'LG 김치냉장고 → 약 · 중 · 강 ≈ ±1 ✓';
    expect(substituteUnsupportedChars(covered)).toBe(covered);
  });

  it('produces text the shaper renders without a single missing glyph', () => {
    // The doc-definition assertions above compare strings; this one asks the real
    // shaper, which is what actually decides whether the reader sees a tofu box.
    const source = '온도 -1.0℃ / 5㎏ / ㈜LG / ※ 참고 / Ⅳ / ㎡';
    const notdefBefore = FACES[0].layout(source).glyphs.filter((g) => g.id === 0);
    expect(notdefBefore.length).toBeGreaterThan(0);

    const substituted = substituteUnsupportedChars(source);
    for (const face of FACES) {
      expect(face.layout(substituted).glyphs.filter((g) => g.id === 0)).toEqual([]);
    }
  });
});
