import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  CURATED_FALLBACKS,
  PDF_CHAR_FALLBACKS,
  substituteUnsupportedChars,
} from '../../src/export/pdf-charmap';
import { NFKC_FALLBACKS } from '../../src/export/pdf-charmap-generated';
import { COVERED_RANGES } from '../../src/export/pdf-coverage-generated';
import { isCodePointCovered } from '../../src/export/pdf';
import { deriveCoverageRanges, deriveNfkcFallbacks } from '../../scripts/pdf-charmap-rule.mjs';

// fontkit ships no type declarations, so it is required untyped and narrowed here.
// It is the same shaper pdfkit (and therefore pdfmake) uses, so asking it which code
// points the embedded files can draw is the same question the PDF renderer asks.
interface FontkitFont {
  characterSet: number[];
  hasGlyphForCodePoint(codePoint: number): boolean;
  layout(text: string, features?: unknown): { glyphs: Array<{ id: number; name: string }> };
}
const fontkit = createRequire(import.meta.url)('fontkit') as {
  openSync(path: string): FontkitFont;
};
const FACES = ['Jetendard-Regular.ttf', 'Jetendard-Bold.ttf'].map((name) =>
  fontkit.openSync(fileURLToPath(new URL(`../../public/fonts/${name}`, import.meta.url))),
);
// Both faces, not just Regular: a bold Markdown run is laid out with the Bold file,
// so a glyph only one face carries still exports as a tofu box in `**strong**` text.
// No assertion below can currently fail on this alone — the two shipped faces have
// identical coverage over the scanned range, so narrowing this to one face leaves the
// suite green. The clause guards the NEXT font swap, not this one.
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

  it('keys the table by single code points only', () => {
    // A multi-code-point key would compile into the character class as its first half
    // alone, and the replace callback would then look up a key that is not in the
    // table — writing the literal string "undefined" into the exported PDF.
    const multiCodePoint = Object.keys(PDF_CHAR_FALLBACKS).filter((key) => [...key].length !== 1);
    expect(multiCodePoint).toEqual([]);
  });

  it('never spells a replacement with a character that has an ASCII equivalent', () => {
    // NFKC reaches for typographic punctuation (`㎧` → `m∕s`, `‑` → `‐`, `⁻` → `−`).
    // It renders, but text copied out of the PDF then fails a Ctrl-F for `m/s` or
    // `ABC-123` and breaks when pasted into code — which defeats the point of
    // substituting at all. The rule folds these; this pins that it did.
    const unfolded = Object.entries(PDF_CHAR_FALLBACKS)
      .filter(([, to]) => /[\u2215\u2044\u2010\u2011\u2012\u2212\u2032\u2033]/.test(to))
      .map(([from, to]) => `${from} -> ${to}`);
    expect(unfolded).toEqual([]);
  });

  it('pins the non-ASCII characters replacements are still allowed to contain', () => {
    // The characters above are folded because ASCII says the same thing. These are the
    // ones left standing because it does not: letters and brackets from other scripts,
    // and symbols with no ASCII spelling. Pinning the exact set means a font swap that
    // introduces a new one fails here and forces that judgement to be made again,
    // rather than quietly shipping another `m∕s`.
    const survivors = [
      ...new Set(
        Object.values(PDF_CHAR_FALLBACKS)
          .flatMap((to) => [...to])
          .filter((char) => (char.codePointAt(0) as number) > 0x7e),
      ),
    ].sort();
    const categorised = {
      // Greek and Cyrillic letters, from the squared units and enclosed letter forms.
      greekCyrillic: survivors.filter((c) => /[\u0370-\u03ff\u0400-\u04ff]/.test(c)),
      // Hangul and CJK: syllables, choseong jamo, and the bracket punctuation the
      // vertical/small compatibility forms decompose to.
      cjk: survivors.filter((c) => /[\u1100-\u11ff\u3000-\u303f\uac00-\ud7af]/.test(c)),
      // Latin letters other scripts' transliterations need (æ ø ħ ə œ ŋ ž), and `°`.
      latin: survivors.filter((c) => /[\u00a5-\u02af]/.test(c)),
      // Combining marks NFKC leaves on spacing diacritics, plus the box-drawing bar.
      marks: survivors.filter((c) => /[\u0300-\u036f\u2502]/.test(c)),
      // Symbols with no ASCII spelling: dashes that are punctuation rather than a
      // stand-in for `-`, arrows, maths operators, geometric shapes, and the two
      // curated check marks (`✔` → `✓`, `✘` → `✗`).
      symbols: survivors.filter((c) =>
        /[\u2013\u2014\u2190-\u2193\u2200-\u22ff\u25a0-\u25ff\u2713\u2717]/.test(c),
      ),
    };
    const uncategorised = survivors.filter(
      (c) => !Object.values(categorised).some((group) => group.includes(c)),
    );
    expect(uncategorised).toEqual([]);
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

  it('spells slashes, hyphens and minus signs as ASCII', () => {
    // `\u00b9` is left alone: the font draws it, so there is nothing to fix.
    expect(substituteUnsupportedChars('12㎧ ⅜ ABC\u2011123 x\u207B\u00b9')).toBe(
      '12m/s 3/8 ABC-123 x-\u00b9',
    );
  });

  it('rewrites the pseudo-bold letters chat models emit as prose', () => {
    // Mathematical Alphanumeric Symbols (U+1D400–1D7FF): astral code points, and the
    // block a hand-picked scan range missed. `𝐍𝐨𝐭𝐞` exported as four tofu boxes.
    expect(substituteUnsupportedChars('\u{1D40D}\u{1D428}\u{1D42D}\u{1D41E}: -1.0\u{2103}')).toBe(
      'Note: -1.0\u00b0C',
    );
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
    const source = '온도 -1.0℃ / 5㎏ / ㈜LG / ※ 참고 / Ⅳ / ㎡ / \u{1D40D}\u{1D428}\u{1D42D}\u{1D41E}';
    const notdefBefore = FACES[0].layout(source).glyphs.filter((g) => g.id === 0);
    expect(notdefBefore.length).toBeGreaterThan(0);

    const substituted = substituteUnsupportedChars(source);
    for (const face of FACES) {
      expect(face.layout(substituted).glyphs.filter((g) => g.id === 0)).toEqual([]);
    }
  });
});

describe('the PDF coverage table', () => {
  it('matches what the embedded fonts actually cover', () => {
    // The same drift guarantee the fallback table has: re-derive from the .ttf files
    // and compare. A font swap that changes coverage must regenerate this table, or
    // the exporter's undrawable-character warning would be answering from a stale map
    // — under-warning (silent tofu) or over-warning (noise on characters that render).
    const derived = deriveCoverageRanges(FACES.map((face) => face.characterSet));
    expect(COVERED_RANGES).toEqual(derived);
  });

  it('is ascending and has no adjacent or overlapping ranges', () => {
    // collectUnsupportedChars binary-searches this table, which is only correct on a
    // sorted, disjoint list. Adjacent ranges would also mean the generator failed to
    // merge, which is a silent size regression rather than a wrong answer.
    for (const [start, end] of COVERED_RANGES) expect(start).toBeLessThanOrEqual(end);
    for (let i = 1; i < COVERED_RANGES.length; i++) {
      expect(COVERED_RANGES[i][0]).toBeGreaterThan(COVERED_RANGES[i - 1][1] + 1);
    }
  });

  it('answers what the shaper answers, for named characters either side of the boundary', () => {
    // Reads the committed table (isCodePointCovered) and checks it against fontkit —
    // NOT fontkit against itself. Anchored on real characters so a generator bug that
    // produced a self-consistent but wrong table still fails.
    for (const char of ['A', '한', '→', '±']) {
      expect(isCodePointCovered(char.codePointAt(0) as number)).toBe(true);
      expect(hasGlyph(char.codePointAt(0) as number)).toBe(true);
    }
    for (const char of ['あ', 'ア', '😀', '✅', '中']) {
      expect(isCodePointCovered(char.codePointAt(0) as number)).toBe(false);
      expect(hasGlyph(char.codePointAt(0) as number)).toBe(false);
    }
  });

  it('agrees with the shaper across the whole scanned range', () => {
    // The two tables in this module come from DIFFERENT fontkit APIs: the coverage
    // ranges from `face.characterSet`, the NFKC fallbacks from
    // `face.hasGlyphForCodePoint`. They agree on the two faces shipped today, but that
    // is an observation about these files, not a guarantee about the API pair — and if
    // a future face made them diverge, collectUnsupportedChars would silently under- or
    // over-warn with every other test still green. Sweep the range the fallback rule
    // itself scans and pin the equivalence.
    const disagreements: number[] = [];
    for (const [from, to] of [
      [0x0020, 0xd7ff],
      [0xe000, 0xffff],
      [0x10000, 0x1ffff],
    ]) {
      for (let cp = from; cp <= to; cp++) {
        if (isCodePointCovered(cp) !== hasGlyph(cp)) disagreements.push(cp);
      }
    }
    expect(
      disagreements.slice(0, 20),
      `${disagreements.length} code point(s) where the committed table and fontkit disagree`,
    ).toEqual([]);
  });
});
