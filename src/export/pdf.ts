// PDF exporter: maps the normalized Conversation model into a pdfmake document
// definition. Provider-agnostic and DOM-free (docs/conventions.md) — it consumes
// only the Conversation and returns a plain object, so it is unit-tested at the
// document-definition level (design's testing decision) without a browser or the
// pdfmake runtime. Building/downloading the actual PDF (which touches browser
// APIs) lives in the content layer (src/content/pdf-download.ts).
//
// The whole document renders in one embedded monospace font (Jetendard: JetBrains
// Mono + Pretendard), so Korean/CJK glyphs render and fenced code blocks are
// monospace by construction; code blocks additionally get a boxed background so
// they stand apart from prose. Output is deterministic (no Date/randomness here).

import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Conversation, Role } from '../core/conversation';
import { buildExportFilename } from './filename';

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
};

/**
 * Map a Conversation into a pdfmake document definition. Deterministic: the same
 * Conversation always yields a deep-equal object.
 */
export function toPdfDocDefinition(conversation: Conversation): TDocumentDefinitions {
  const content: Content[] = [{ text: stripNewlines(conversation.title), style: 'title' }];
  for (const message of conversation.messages) {
    content.push({ text: ROLE_LABEL[message.role], style: 'role' });
    content.push(...renderBody(message.content));
  }
  return {
    content,
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

// Split a message body into prose and fenced-code segments, mapping each to a
// content node: prose keeps its text but has inline-code spans lifted into styled
// runs (other inline Markdown syntax is still left as literal text — full Markdown
// styling is out of scope for v1), code segments get the boxed monospace `code`
// style. Leading-space preservation on code keeps indentation intact.
function renderBody(body: string): Content[] {
  const nodes: Content[] = [];
  for (const segment of splitFencedCode(body)) {
    if (segment.text.trim().length === 0) continue; // drop empty prose/code segments
    if (segment.code) {
      nodes.push({ text: segment.text, style: 'code' });
    } else {
      nodes.push({ text: splitInlineCode(segment.text.trim()), margin: [0, 2, 0, 2] });
    }
  }
  return nodes;
}

// A Markdown inline-code span: a run of N backticks, a body, then a closing run of
// exactly N (the `\1` backreference, plus the guards that keep the run from being
// part of a longer one). Both details are forced by what this repo's own serializer
// emits (src/core/html-to-markdown.ts):
//   - `inlineCode` fences with `longestBacktickRun + 1` backticks and pads the body
//     with a space when the code text itself contains a backtick, per CommonMark —
//     so a single-backtick pattern would tear those spans apart mid-content.
//   - `escapeMarkdownText` escapes every literal backtick in prose as `` \` ``, so a
//     backslash-preceded run is not a delimiter at all and must not pair with one.
// An unpaired run, an empty span and a span straddling a line break still fail to
// match and stay literal text, which is what the source page showed.
const INLINE_CODE = /(?<![\\`])(`+)([^\n]*?)(?<![\\`])\1(?!`)/g;

// Lift inline-code spans out of a prose run: the backticks are dropped and the code
// text gets the `inlineCode` style, so the marker is replaced by the styling it was
// standing in for rather than surviving as stray punctuation. Prose with no inline
// code stays a plain string, keeping the common node shape unchanged.
function splitInlineCode(text: string): string | Content[] {
  const runs: Content[] = [];
  const re = new RegExp(INLINE_CODE.source, INLINE_CODE.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const code = stripCodePadding(match[2]);
    if (code.length === 0) continue; // an empty span is not code — leave it literal
    if (match.index > lastIndex) {
      runs.push({ text: unescapeMarkdown(text.slice(lastIndex, match.index)) });
    }
    runs.push({ text: code, style: 'inlineCode' });
    lastIndex = re.lastIndex;
  }
  if (runs.length === 0) return unescapeMarkdown(text);
  if (lastIndex < text.length) {
    runs.push({ text: unescapeMarkdown(text.slice(lastIndex)) });
  }
  return runs;
}

// A CommonMark backslash escape: a backslash followed by ASCII punctuation. Any
// other backslash is a literal one and is left as it stands.
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g;

// Undo the escaping `escapeMarkdownText` applied upstream. That pass exists so the
// *Markdown* export stays valid source; this exporter renders prose instead — it
// drops the fences and the inline-code backticks — so a surviving backslash is
// punctuation the source page never showed (`a \` b` for a literal backtick,
// `\[1\]`, `\|`, `\*`). Applied ONLY to prose runs: code bodies, inline and fenced,
// are never escaped in the first place (see src/core/markdown-escape.ts), so
// unescaping them would eat a real backslash out of a regex or a Windows path.
// A single left-to-right pass, which is what makes the doubled backslash the
// escaper emits first (`C:\path` → `C:\\path`) round-trip to one rather than
// exposing the character it protects.
function unescapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_ESCAPE, '$1');
}

// CommonMark: one leading and one trailing space are stripped from a code span
// when both are present and the body is not all spaces — the padding the
// serializer adds so a body touching a backtick stays parseable.
function stripCodePadding(body: string): string {
  if (body.length >= 2 && body.startsWith(' ') && body.endsWith(' ') && body.trim().length > 0) {
    return body.slice(1, -1);
  }
  return body;
}

interface Segment {
  text: string;
  code: boolean;
}

// A fenced code block: an opening fence of three-or-more backticks (optionally
// with a language label) on its own line, arbitrary body, then a closing fence of
// the SAME length on its own line. The adapter (html-to-markdown serializeCodeBlock)
// emits a fence one backtick longer than the longest backtick run inside the body,
// so the length varies; the `\2` backreference matches whatever length was opened.
// Group 2 captures the body; the fences and language label are dropped.
const FENCED_CODE = /^[ \t]*(`{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm;

// Partition `body` into an ordered list of prose/code segments. Deterministic and
// allocation-light; regex state is local so repeated calls are independent.
function splitFencedCode(body: string): Segment[] {
  const segments: Segment[] = [];
  const re = new RegExp(FENCED_CODE.source, FENCED_CODE.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: body.slice(lastIndex, match.index), code: false });
    }
    segments.push({ text: match[2], code: true });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < body.length) {
    segments.push({ text: body.slice(lastIndex), code: false });
  }
  return segments;
}

// Flatten any newlines in the title so it stays a single heading line.
function stripNewlines(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}
