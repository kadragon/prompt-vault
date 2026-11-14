import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { conversation } from '../fixtures/conversation';
import {
  collectUnsupportedChars,
  isCjkCodePointCovered,
  isCodePointCovered,
  PDF_CJK_FONT,
  PDF_FONT,
  toPdfDocDefinition,
  usesCjkFont,
} from '../../src/export/pdf';
import { CJK_COVERED_RANGES } from '../../src/export/pdf-cjk-coverage-generated';
import { deriveCoverageRanges } from '../../scripts/pdf-charmap-rule.mjs';

// fontkit ships no type declarations, so it is required untyped and narrowed here.
interface FontkitFont {
  characterSet: number[];
  hasGlyphForCodePoint(codePoint: number): boolean;
  layout(text: string): { glyphs: Array<{ id: number }> };
}
const require = createRequire(import.meta.url);
const fontkit = require('fontkit') as { openSync(path: string): FontkitFont };
const fontPath = (name: string): string => fileURLToPath(new URL(`../../public/fonts/${name}`, import.meta.url));
const CJK_FACES = ['PromptVaultCJK-Regular.otf', 'PromptVaultCJK-Bold.otf'].map((name) =>
  fontkit.openSync(fontPath(name)),
);

// Common characters of each audience the subset is for, spelled the way each writes them.
const JAPANESE = 'こんにちは、カタカナ。日本語の漢字を書く「東京」ー';
const SIMPLIFIED = '简体中文：这是汉语，我们说话。';
const TRADITIONAL = '繁體中文：這是臺灣的國語，說話。';

const cp = (char: string): number => char.codePointAt(0) as number;

type Run = { text: string; font?: string; bold?: boolean; link?: string; characterSpacing?: number };

function bodyNode(content: string): { text: unknown; style?: unknown } {
  const doc = toPdfDocDefinition(conversation({ messages: [{ role: 'user', content }] }));
  const nodes = doc.content as Array<{ text: unknown; style?: unknown }>;
  return nodes.find((n) => n.style !== 'title' && n.style !== 'role')!;
}

describe('CJK font routing', () => {
  it('splits a prose run into same-face segments, CJK ones naming the CJK family', () => {
    const runs = bodyNode('Hello こんにちは 世界!').text as Run[];
    expect(runs.map((r) => [r.text, r.font])).toEqual([
      ['Hello ', undefined],
      ['こんにちは', PDF_CJK_FONT],
      [' ', undefined],
      ['世界', PDF_CJK_FONT],
      ['!', undefined],
    ]);
  });

  it('keeps an inline run’s own style on every segment it is split into', () => {
    // pdfmake flattens nested text arrays and drops the inner object's style, so a bold
    // or linked run must become sibling copies rather than a nested array.
    const runs = (bodyNode('a **太字 bold** [日本](https://example.com/x) z').text as Run[]).filter(
      (r) => r.bold || r.link,
    );
    expect(runs).toEqual([
      expect.objectContaining({ text: '太字', font: PDF_CJK_FONT, bold: true }),
      expect.objectContaining({ text: ' bold', bold: true }),
      expect.objectContaining({ text: '日本', font: PDF_CJK_FONT, link: 'https://example.com/x' }),
    ]);
    for (const run of runs) expect(run.text).not.toBe('');
  });

  it('turns a plain-string node into segments that inherit the node’s style', () => {
    const doc = toPdfDocDefinition(conversation({ title: '東京 trip', messages: [] }));
    const title = (doc.content as Array<{ text: unknown; style?: string }>)[0];
    expect(title.style).toBe('title');
    expect(title.text).toEqual([{ text: '東京', font: PDF_CJK_FONT }, { text: ' trip' }]);
  });

  it('leaves Hangul and Latin on Jetendard, with the node shape unchanged', () => {
    const doc = toPdfDocDefinition(
      conversation({ title: '냉장고 설정', messages: [{ role: 'user', content: 'LG → 약 · 중 ±1' }] }),
    );
    expect(usesCjkFont(doc)).toBe(false);
    expect((doc.content as Array<{ text: unknown }>)[0].text).toBe('냉장고 설정');
    expect(doc.defaultStyle?.font).toBe(PDF_FONT);
  });

  it('routes code-block CJK too, and reports the document as needing the CJK faces', () => {
    const doc = toPdfDocDefinition(
      conversation({ messages: [{ role: 'user', content: '```\nprint("中文")\n```' }] }),
    );
    expect(usesCjkFont(doc)).toBe(true);
    expect(JSON.stringify(doc.content)).toContain(`{"text":"中文","font":"${PDF_CJK_FONT}","characterSpacing":1.8}`);
  });

  it('no longer reports kana or common hanzi as undrawable, in any of the three scripts', () => {
    const doc = toPdfDocDefinition(
      conversation({ messages: [{ role: 'user', content: `${JAPANESE}\n\n${SIMPLIFIED}\n\n${TRADITIONAL}` }] }),
    );
    expect(collectUnsupportedChars(doc)).toEqual([]);
  });
});

describe('substitution against the CJK face', () => {
  it('keeps every CJK-covered stand-in character as itself once the document loads the CJK face', () => {
    const doc = toPdfDocDefinition(conversation({ messages: [{ role: 'user', content: '※注意 ① ★ ℃ Ⅳ ‥' }] }));
    const runs = bodyNode('※注意 ① ★ ℃ Ⅳ ‥').text as Run[];
    expect(usesCjkFont(doc)).toBe(true);
    expect(runs.map((r) => r.text).join('')).toBe('※注意 ① ★ ℃ Ⅳ ‥');
    for (const char of ['※', '①', '★', '℃', 'Ⅳ', '‥']) {
      expect(runs.find((r) => r.text.includes(char))?.font).toBe(PDF_CJK_FONT);
    }
    expect(collectUnsupportedChars(doc)).toEqual([]);
  });

  it('still substitutes them in a document that needs no CJK face, which then never names it', () => {
    const doc = toPdfDocDefinition(
      conversation({ title: '※ 메모', messages: [{ role: 'user', content: '※참고 ① 온도 -1.0℃ ★' }] }),
    );
    expect(usesCjkFont(doc)).toBe(false);
    expect(JSON.stringify(doc.content)).not.toMatch(/[※①℃★]/);
  });

  it('keeps them in every node, the title and code included, when CJK appears anywhere', () => {
    const doc = toPdfDocDefinition(
      conversation({ title: '※ 메모', messages: [{ role: 'user', content: '```\nt = 1℃\n```\n\n日本' }] }),
    );
    const text = JSON.stringify(doc.content);
    expect(text).toContain(`{"text":"※","font":"${PDF_CJK_FONT}"}`);
    expect(text).toContain(`{"text":"℃","font":"${PDF_CJK_FONT}","characterSpacing":1.8}`);
  });

  it('substitutes a stand-in character the CJK face lacks even when the face is loaded', () => {
    // ☑ has a curated fallback and no glyph in either face: keeping it would be a tofu box.
    expect(isCjkCodePointCovered(cp('☑'))).toBe(false);
    const runs = bodyNode('日本 ☑').text as Run[];
    expect(runs.map((r) => r.text).join('')).toBe('日本 [v]');
  });
});

describe('the CJK coverage table', () => {
  it('matches what the embedded CJK faces actually cover', () => {
    const derived = deriveCoverageRanges(CJK_FACES.map((face) => face.characterSet));
    expect(CJK_COVERED_RANGES).toEqual(derived);
  });

  it('is ascending and has no adjacent or overlapping ranges', () => {
    for (const [start, end] of CJK_COVERED_RANGES) expect(start).toBeLessThanOrEqual(end);
    for (let i = 1; i < CJK_COVERED_RANGES.length; i++) {
      expect(CJK_COVERED_RANGES[i][0]).toBeGreaterThan(CJK_COVERED_RANGES[i - 1][1] + 1);
    }
  });

  it('covers every hiragana and katakana letter, and the sampled hanzi, in both weights', () => {
    const wanted = [
      ...Array.from({ length: 0x3096 - 0x3041 + 1 }, (_, i) => 0x3041 + i),
      ...Array.from({ length: 0x30fa - 0x30a1 + 1 }, (_, i) => 0x30a1 + i),
      ...[...`${JAPANESE}${SIMPLIFIED}${TRADITIONAL}`].map(cp).filter((c) => !isCodePointCovered(c)),
    ];
    const missing = wanted.filter(
      (c) => !isCjkCodePointCovered(c) || !CJK_FACES.every((face) => face.hasGlyphForCodePoint(c)),
    );
    expect(missing.map((c) => String.fromCodePoint(c))).toEqual([]);
  });

  it('shapes the samples without a single missing glyph', () => {
    for (const face of CJK_FACES) {
      const text = [...`${JAPANESE}${SIMPLIFIED}${TRADITIONAL}`].filter((c) => !isCodePointCovered(cp(c))).join('');
      expect(face.layout(text).glyphs.filter((g) => g.id === 0)).toEqual([]);
    }
  });

  it('covers jōyō kanji outside JIS X 0208 and level-1 Tongyong hanzi outside GB 2312', () => {
    // 塡 (jōyō since 2010, not in JIS X 0208) and 啰 (Tongyong level 1, GBK only) were the
    // reported gaps; 剝 and 𠮟 are jōyō too, the latter an Extension B character.
    const wanted = ['塡', '剝', '𠮟', '啰'];
    const missing = wanted.filter(
      (c) => !isCjkCodePointCovered(cp(c)) || !CJK_FACES.every((face) => face.hasGlyphForCodePoint(cp(c))),
    );
    expect(missing).toEqual([]);
    const doc = toPdfDocDefinition(conversation({ messages: [{ role: 'user', content: '装塡 啰嗦' }] }));
    expect(collectUnsupportedChars(doc)).toEqual([]);
  });

  it('still leaves rare ideographs outside the subset uncovered', () => {
    // The subset is a size trade-off (scripts/subset-cjk-font.py): an Extension B
    // character keeps exporting as a reported tofu box rather than silently.
    expect(isCjkCodePointCovered(cp('𠮷'))).toBe(false);
  });
});

describe('a real pdfmake render', () => {
  it('embeds both CJK weights next to Jetendard for a mixed Japanese/Chinese/Korean document', async () => {
    // Doc-definition tests cannot see layout-engine failures (a CFF face pdfkit rejects,
    // a nested-array shape pdfmake throws on), so render one real PDF through the
    // node build with the shipped font files.
    const pdfmake = require('pdfmake') as {
      setLocalAccessPolicy(cb: (path: string) => boolean): void;
      setUrlAccessPolicy(cb: (url: string) => boolean): void;
      addFonts(fonts: Record<string, Record<string, string>>): void;
      createPdf(doc: TDocumentDefinitions): { getBuffer(): Promise<Buffer> };
    };
    const fontsDir = fileURLToPath(new URL('../../public/fonts/', import.meta.url));
    pdfmake.setLocalAccessPolicy((path) => path.startsWith(fontsDir));
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.addFonts({
      [PDF_FONT]: {
        normal: fontPath('Jetendard-Regular.ttf'),
        bold: fontPath('Jetendard-Bold.ttf'),
        italics: fontPath('Jetendard-Regular.ttf'),
        bolditalics: fontPath('Jetendard-Bold.ttf'),
      },
      [PDF_CJK_FONT]: {
        normal: fontPath('PromptVaultCJK-Regular.otf'),
        bold: fontPath('PromptVaultCJK-Bold.otf'),
        italics: fontPath('PromptVaultCJK-Regular.otf'),
        bolditalics: fontPath('PromptVaultCJK-Bold.otf'),
      },
    });
    const doc = toPdfDocDefinition(
      conversation({
        title: '東京 메모',
        messages: [
          { role: 'user', content: `${JAPANESE} 안녕하세요\n\n**${SIMPLIFIED}**\n\n- ${TRADITIONAL}` },
          { role: 'assistant', content: '| 列 | 열 |\n| --- | --- |\n| 值 | 값 |\n\n```\nconsole.log("日本")\n```' },
        ],
      }),
    );

    const pdf = (await pdfmake.createPdf(doc).getBuffer()).toString('latin1');

    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansCJKjp-Regular/);
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansCJKjp-Bold/);
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+Jetendard/);
  }, 60_000);
});

describe('CJK in code blocks', () => {
  it('pads each CJK glyph to Jetendard’s two-column width, so columns still line up', () => {
    // Jetendard: 0.6 em per column, Hangul 1.2 em; the CJK face draws 1.0 em, so 0.2 em
    // of trailing spacing at the code style's 9 pt makes a CJK glyph exactly two columns.
    const jetendard = fontkit.openSync(fontPath('Jetendard-Regular.ttf')) as FontkitFont & {
      unitsPerEm: number;
      glyphForCodePoint(cp: number): { advanceWidth: number };
    };
    const cjk = CJK_FACES[0] as FontkitFont & { unitsPerEm: number; glyphForCodePoint(cp: number): { advanceWidth: number } };
    const em = (face: typeof cjk, char: string): number => face.glyphForCodePoint(cp(char)).advanceWidth / face.unitsPerEm;

    const doc = toPdfDocDefinition(conversation({ messages: [{ role: 'user', content: '```\n| 名前 | 값 |\n```' }] }));
    const code = (doc.content as Array<{ text: unknown; style?: string }>).find((n) => n.style === 'code')!;
    const run = (code.text as Run[]).find((r) => r.font === PDF_CJK_FONT)!;

    expect(run.text).toBe('名前');
    expect(em(cjk, '名') + run.characterSpacing! / 9).toBeCloseTo(em(jetendard, '값'), 5);
    expect(em(jetendard, '값')).toBeCloseTo(2 * em(jetendard, 'a'), 5);
  });

  it('leaves prose CJK unpadded', () => {
    const runs = bodyNode('名前').text as Array<{ characterSpacing?: number }>;
    expect(runs.every((r) => r.characterSpacing === undefined)).toBe(true);
  });
});
