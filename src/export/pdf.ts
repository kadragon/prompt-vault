// PDF exporter: maps the normalized Conversation model into a pdfmake document
// definition. Provider-agnostic and DOM-free (docs/conventions.md) — it consumes
// only the Conversation and returns a plain object, so it is unit-tested at the
// document-definition level (design's testing decision) without a browser or the
// pdfmake runtime. Building/downloading the actual PDF (which touches browser
// APIs) lives in the content layer (src/content/pdf-download.ts).
//
// The document renders in one embedded monospace family (Jetendard: JetBrains Mono +
// Pretendard, Regular + Bold), so Hangul and Latin render and fenced code blocks are
// monospace by construction; the characters Jetendard lacks that a Japanese or Chinese
// chat needs (kana, hanzi, CJK punctuation) are routed to a companion CJK face, run by
// run (see withCharFallbacks). Code blocks additionally get a boxed
// background so they stand apart from prose. Message bodies are Markdown, and turning
// that into styled nodes lives in ./markdown-pdf — this module owns the document
// shell: the font, the named styles those nodes reference, and the role sections.
// Output is deterministic (no Date/randomness here).

import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Conversation, Role } from '../core/conversation';
import { buildExportFilename } from './filename';
import { renderMarkdown } from './markdown-pdf';
import { substituteUnsupportedChars } from './pdf-charmap';
import { CJK_COVERED_RANGES } from './pdf-cjk-coverage-generated';
import { COVERED_RANGES } from './pdf-coverage-generated';

// The embedded font family name, referenced by the vfs/fonts registration in the
// content layer. Kept here so the pure doc definition names the same family the
// runtime registers.
export const PDF_FONT = 'Jetendard';

// The companion family for what Jetendard cannot draw (see ./fonts/jetendard). pdfmake
// has no per-glyph font fallback, so withCharFallbacks splits each text run into
// same-face segments and names this family on the CJK ones. A document that never
// names it never makes the content layer read the CJK files.
export const PDF_CJK_FONT = 'PromptVaultCJK';

// Jetendard inherits JetBrains Mono's coding ligatures, which are on by default:
// `=>` is substituted with a single `⇒` glyph, so what the reader copies out of the
// PDF no longer matches what the page showed. pdfmake hands this value straight to
// pdfkit → fontkit, where the object form `{tag: false}` is the only way to turn a
// default-on feature off — the tag-array form can only enable. The pdfmake typings
// describe the array form alone, hence the cast; test/export/pdf.test.ts pins the
// glyph output against the embedded font using the repo's own fontkit. Note the
// shipped shaper is the copy bundled inside `pdfmake/build/pdfmake`, not that
// devDependency — a pdfmake bump warrants re-checking this by hand.
export const PDF_FONT_FEATURES = { calt: false, liga: false } as const;

// Human-readable label per role. Exhaustive over Role so a new role is a compile
// error here rather than a silently unlabeled section (mirrors markdown.ts).
const ROLE_LABEL: Record<Role, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
};

// Jetendard draws Hangul and its full-width punctuation two columns wide (1.2 em on its
// 0.6 em grid); the CJK face's glyphs are 1.0 em. Inside a fenced code block, where columns
// must line up, each CJK glyph gets the missing 0.2 em as trailing spacing — in points,
// which is all pdfmake takes, so it is tied to the code style's own font size.
const CODE_FONT_SIZE = 9;
const CODE_CJK_SPACING = 0.2 * CODE_FONT_SIZE;

// Named styles referenced from content nodes below.
const STYLES: TDocumentDefinitions['styles'] = {
  title: { fontSize: 16, bold: true, margin: [0, 0, 0, 10] },
  role: { fontSize: 12, bold: true, color: '#10a37f', margin: [0, 10, 0, 4] },
  code: {
    fontSize: CODE_FONT_SIZE,
    background: '#f4f4f4',
    color: '#24292e',
    preserveLeadingSpaces: true,
    margin: [0, 2, 0, 2],
  },
  // Inline code inside prose: same tint as the fenced block so the run reads as
  // code, which is what justifies dropping its Markdown backticks. No margin —
  // it is an inline run inside a paragraph, not a block.
  inlineCode: { background: '#f4f4f4', color: '#24292e' },
  // Markdown headings. The family ships one upright weight plus Bold, so the level
  // is carried by size and weight — a heading must not rely on a face we do not
  // embed. Sizes step down to the 10pt body without ever colliding with the 16pt
  // document title.
  h1: { fontSize: 15, bold: true, margin: [0, 8, 0, 4] },
  h2: { fontSize: 13.5, bold: true, margin: [0, 8, 0, 4] },
  h3: { fontSize: 12.5, bold: true, margin: [0, 6, 0, 3] },
  h4: { fontSize: 11.5, bold: true, margin: [0, 6, 0, 3] },
  h5: { fontSize: 11, bold: true, margin: [0, 4, 0, 2] },
  h6: { fontSize: 10.5, bold: true, margin: [0, 4, 0, 2] },
  // A link run: the underline is what survives printing, the colour is what reads as
  // clickable on screen. The href itself rides on the node's `link` property, which
  // is what makes the PDF annotation.
  link: { color: '#0969da', decoration: 'underline' },
  // A table's header row. Same weight cue the source page used, so the grid reads
  // without the Markdown divider line the renderer consumed.
  tableHeader: { bold: true },
};

/**
 * Map a Conversation into a pdfmake document definition. Deterministic: the same
 * Conversation always yields a deep-equal object.
 */
export function toPdfDocDefinition(conversation: Conversation): TDocumentDefinitions {
  const content: Content[] = [{ text: stripNewlines(conversation.title), style: 'title' }];
  for (const message of conversation.messages) {
    content.push({ text: ROLE_LABEL[message.role], style: 'role' });
    content.push(...renderMarkdown(message.content));
  }
  return {
    content: withFontRouting(content),
    defaultStyle: {
      font: PDF_FONT,
      fontSize: 10,
      // See PDF_FONT_FEATURES: the object form is deliberate and unrepresentable
      // in pdfmake's tag-array typing.
      fontFeatures: PDF_FONT_FEATURES as unknown as PDFKit.Mixins.OpenTypeFeatures[],
    },
    styles: STYLES,
    pageMargins: [40, 40, 40, 40],
  };
}

/**
 * Build the PDF download filename `{provider}-{safe-title}-{yyyymmdd}.pdf`.
 * Shares sanitization with every other exporter (docs/conventions.md).
 */
export function pdfFilename(conversation: Conversation, now: Date): string {
  return buildExportFilename(conversation, now, 'pdf');
}

// Rewrite every text run the font has no glyph for (see ./pdf-charmap), then route what
// Jetendard still cannot draw but the CJK face can to PDF_CJK_FONT. This runs on the
// finished nodes rather than on the Markdown source so a substitution that yields `*` or
// `_` can never be re-read as emphasis, and it copies rather than mutates: the renderer
// reuses shared (and sometimes frozen) node and layout constants, and layout callbacks
// must survive by reference.
// A node's own `text` string becomes an array of segments, which inherit the node's style
// the way any inline array does. An inline object INSIDE a text array cannot nest that
// way — pdfmake flattens nested arrays and drops the inner object's own style — so it is
// split into sibling copies instead, each keeping every property of the original.
// Two passes, so the CJK face's 7.8 MB is only ever loaded for text that needs it. The
// first substitutes everything; if what survives still routes to the CJK face, the face is
// loaded anyway, and the second pass keeps every character it can draw — `※注意` stays
// `※注意` beside the kana instead of folding to `*注意`. A document the first pass leaves
// CJK-free (a Korean chat with one `※`) keeps the substitutions and never names the face.
function withFontRouting<T>(content: T): T {
  const substituted = withCharFallbacks(content, undefined);
  return namesCjkFont(substituted) ? withCharFallbacks(content, keepForCjk) : substituted;
}

function keepForCjk(char: string): boolean {
  return isCjkCodePointCovered(char.codePointAt(0) as number);
}

type Keep = ((char: string) => boolean) | undefined;

function withCharFallbacks<T>(node: T, keep: Keep): T {
  if (Array.isArray(node)) return (node as unknown[]).map((child) => withCharFallbacks(child, keep)) as T;
  if (node === null || typeof node !== 'object') return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'text' && typeof value === 'string') {
      const runs = fontRuns(substituteUnsupportedChars(value, keep));
      const spacing = (node as { style?: unknown }).style === 'code' ? CODE_CJK_SPACING : undefined;
      copy[key] = runs.length === 1 && !runs[0].cjk ? runs[0].text : runs.map((run) => inlineRun(run, spacing));
    } else if (key === 'text' && Array.isArray(value)) {
      copy[key] = value.flatMap((item: unknown) => inlineWithFallbacks(item, keep));
    } else {
      copy[key] = withCharFallbacks(value, keep);
    }
  }
  return copy as T;
}

function inlineWithFallbacks(item: unknown, keep: Keep): unknown[] {
  if (typeof item === 'string') return fontRuns(substituteUnsupportedChars(item, keep)).map((run) => inlineRun(run));
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    const { text, ...rest } = item as Record<string, unknown>;
    if (typeof text === 'string') {
      const props = withCharFallbacks(rest, keep);
      return fontRuns(substituteUnsupportedChars(text, keep)).map((run) =>
        run.cjk ? { ...props, text: run.text, font: PDF_CJK_FONT } : { ...props, text: run.text },
      );
    }
  }
  return [withCharFallbacks(item, keep)];
}

// Always an object, never a bare string: both walks here (and the test pinning them)
// rely on every visible string sitting under a `text` key.
function inlineRun(run: FontRun, spacing?: number): { text: string; font?: string; characterSpacing?: number } {
  if (!run.cjk) return { text: run.text };
  return spacing === undefined ? { text: run.text, font: PDF_CJK_FONT } : { text: run.text, font: PDF_CJK_FONT, characterSpacing: spacing };
}


interface FontRun {
  text: string;
  cjk: boolean;
}

// Maximal same-face runs of `text`, never empty: an empty string is one Jetendard run, so
// a node keeps its (empty) text. A character goes to the CJK face only when Jetendard
// lacks it and the CJK face has it; anything neither draws stays on Jetendard and is
// reported by collectUnsupportedChars.
function fontRuns(text: string): FontRun[] {
  const runs: FontRun[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0) as number;
    const cjk = !isCodePointCovered(cp) && isCjkCodePointCovered(cp);
    const last = runs.at(-1);
    if (last && last.cjk === cjk) last.text += char;
    else runs.push({ text: char, cjk });
  }
  return runs.length > 0 ? runs : [{ text: '', cjk: false }];
}

/** Whether the built document names PDF_CJK_FONT anywhere, so the CJK faces must be loaded. */
export function usesCjkFont(doc: TDocumentDefinitions): boolean {
  return namesCjkFont(doc.content);
}

function namesCjkFont(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(namesCjkFont);
  if (node === null || typeof node !== 'object') return false;
  return Object.entries(node).some(([key, value]) =>
    key === 'font' ? value === PDF_CJK_FONT : namesCjkFont(value),
  );
}

/**
 * The characters in a built document definition that no embedded face can draw, sorted
 * and deduplicated. They reach the PDF as tofu boxes, so the content layer warns about
 * them rather than shipping a silently degraded file (AGENTS.md #4).
 *
 * Runs on the finished, already-substituted definition — the answer is what survives
 * ./pdf-charmap, not what the source text happened to contain. Pure and DOM-free like
 * the rest of this module: it reports, it does not mutate.
 */
export function collectUnsupportedChars(doc: TDocumentDefinitions): string[] {
  const found = new Set<string>();
  collectFrom(doc.content, found);
  return [...found].sort();
}

// Same structural walk as withCharFallbacks, and it relies on the same invariant:
// every user-visible string sits under a `text` key. test/export/pdf.test.ts pins that
// ("emits no visible text outside a `text` property for the walk to miss"), so the two
// walks cannot drift apart without a test failing.
function collectFrom(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) collectFrom(child, found);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'text' && typeof value === 'string') {
      for (const char of value) {
        if (!isDrawable(char)) found.add(char);
      }
    } else {
      collectFrom(value, found);
    }
  }
}

/**
 * Whether the embedded Jetendard faces carry a glyph for `codePoint`, by binary search over the
 * generated ranges. Exported so test/export/pdf-charmap.test.ts can cross-check the
 * committed table against fontkit's own answer — the table is derived from
 * `face.characterSet` while ./pdf-charmap is derived from `hasGlyphForCodePoint`, and
 * nothing else pins those two APIs to each other.
 */
export function isCodePointCovered(codePoint: number): boolean {
  return inRanges(COVERED_RANGES, codePoint);
}

/** Whether the embedded CJK faces carry a glyph for `codePoint`; see isCodePointCovered. */
export function isCjkCodePointCovered(codePoint: number): boolean {
  return inRanges(CJK_COVERED_RANGES, codePoint);
}

function inRanges(ranges: ReadonlyArray<readonly [number, number]>, codePoint: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const [start, end] = ranges[mid];
    if (codePoint < start) high = mid - 1;
    else if (codePoint > end) low = mid + 1;
    else return true;
  }
  return false;
}

// Whitespace is exempt: a space, tab or newline is laid out, never drawn, so an
// uncovered one is not a tofu box and warning about it would be noise the user cannot
// act on.
function isDrawable(char: string): boolean {
  if (/\s/.test(char)) return true;
  const cp = char.codePointAt(0) as number;
  return isCodePointCovered(cp) || isCjkCodePointCovered(cp);
}

// Flatten any newlines in the title so it stays a single heading line.
function stripNewlines(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}
