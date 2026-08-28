// PDF exporter: maps the normalized Conversation model into a pdfmake document
// definition. Provider-agnostic and DOM-free (docs/conventions.md) — it consumes
// only the Conversation and returns a plain object, so it is unit-tested at the
// document-definition level (design's testing decision) without a browser or the
// pdfmake runtime. Building/downloading the actual PDF (which touches browser
// APIs) lives in the content layer (src/content/pdf-download.ts).
//
// The whole document renders in one embedded monospace family (Jetendard: JetBrains
// Mono + Pretendard, Regular + Bold), so Korean/CJK glyphs render and fenced code
// blocks are monospace by construction; code blocks additionally get a boxed
// background so they stand apart from prose. Message bodies are Markdown, and turning
// that into styled nodes lives in ./markdown-pdf — this module owns the document
// shell: the font, the named styles those nodes reference, and the role sections.
// Output is deterministic (no Date/randomness here).

import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Conversation, Role } from '../core/conversation';
import { buildExportFilename } from './filename';
import { renderMarkdown } from './markdown-pdf';
import { substituteUnsupportedChars } from './pdf-charmap';

// The embedded font family name, referenced by the vfs/fonts registration in the
// content layer. Kept here so the pure doc definition names the same family the
// runtime registers.
export const PDF_FONT = 'Jetendard';

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

// Named styles referenced from content nodes below.
const STYLES: TDocumentDefinitions['styles'] = {
  title: { fontSize: 16, bold: true, margin: [0, 0, 0, 10] },
  role: { fontSize: 12, bold: true, color: '#10a37f', margin: [0, 10, 0, 4] },
  code: {
    fontSize: 9,
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
    content: withCharFallbacks(content),
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

// Rewrite every text run the font has no glyph for (see ./pdf-charmap). This runs on
// the finished nodes rather than on the Markdown source so a substitution that yields
// `*` or `_` can never be re-read as emphasis, and it copies rather than mutates:
// the renderer reuses shared (and sometimes frozen) node and layout constants, and
// layout callbacks must survive by reference.
function withCharFallbacks<T>(node: T): T {
  if (Array.isArray(node)) return node.map(withCharFallbacks) as T;
  if (node === null || typeof node !== 'object') return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    copy[key] =
      key === 'text' && typeof value === 'string'
        ? substituteUnsupportedChars(value)
        : withCharFallbacks(value);
  }
  return copy as T;
}

// Flatten any newlines in the title so it stays a single heading line.
function stripNewlines(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}
