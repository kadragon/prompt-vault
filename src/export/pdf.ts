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
    defaultStyle: { font: PDF_FONT, fontSize: 10 },
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
// content node: prose is emitted verbatim (inline Markdown syntax is left as
// literal text — full Markdown styling is out of scope for v1), code segments get
// the boxed monospace `code` style. Leading-space preservation on code keeps
// indentation intact.
function renderBody(body: string): Content[] {
  const nodes: Content[] = [];
  for (const segment of splitFencedCode(body)) {
    if (segment.text.trim().length === 0) continue; // drop empty prose/code segments
    if (segment.code) {
      nodes.push({ text: segment.text, style: 'code' });
    } else {
      nodes.push({ text: segment.text.trim(), margin: [0, 2, 0, 2] });
    }
  }
  return nodes;
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
