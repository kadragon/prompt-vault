// Markdown → pdfmake renderer. Turns a normalized `Message.content` (GitHub-flavored
// Markdown) into pdfmake content nodes, so the PDF shows the formatting the source
// page showed instead of the Markdown markers standing in for it (`**bold**`,
// `[label](url)`, `> quote`).
//
// Provider-agnostic, pure and DOM-free (docs/conventions.md): the input is the
// normalized model's Markdown and the output is a plain object graph, so the whole
// renderer is unit-tested without a browser or the pdfmake runtime. Deterministic —
// no Date/randomness, and the shared layout constant below is one frozen object so
// repeated renders of the same body are deep-equal.
//
// The grammar it parses is NOT arbitrary CommonMark: it is exactly what this repo's
// own serializer (src/core/html-to-markdown.ts) emits — ATX headings, paragraphs,
// fenced code, `- `/`N. ` lists (nested by marker-width indent, with continuation
// blocks), GFM tables, `> ` blockquotes, `---` rules, and the inline set
// `**strong**` / `*em*` / `` `code` `` / `[text](href)` / `![alt](src)`. Anything the
// serializer cannot produce is left as literal text rather than guessed at.
//
// Block classification runs on the RAW line, before Markdown escapes are undone:
// `escapeMarkdownText` backslash-escapes a leading `#`, `>`, `-`, `*`, `+`, ordered
// marker and every literal `|`, so a line that only *looks* like a block marker
// still carries its backslash here and correctly stays prose. Unescaping happens
// last, on prose runs only (code bodies and hrefs are never escaped upstream).

import type { Content, TableCell } from 'pdfmake/interfaces';

/** Inline styling accumulated by nesting (`**[a *b* ](url)**`). */
interface Marks {
  bold?: true;
  italics?: true;
  link?: string;
}

/**
 * Render one message body as pdfmake content nodes, in document order.
 * Empty/whitespace-only blocks are dropped rather than emitted as blank nodes.
 */
export function renderMarkdown(body: string): Content[] {
  return renderBlocks(body.split('\n'));
}

// ---------------------------------------------------------------- block layer

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const HR = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const FENCE_OPEN = /^[ \t]*(`{3,})/;
const LIST_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+/;
const TABLE_ROW = /^[ \t]*\|/;
const TABLE_DIVIDER = /^[ \t]*\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*$/;

function renderBlocks(lines: string[]): Content[] {
  const nodes: Content[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const end = findFenceEnd(lines, i, fence[1].length);
      if (end !== -1) {
        const code = lines.slice(i + 1, end).join('\n');
        if (code.trim().length > 0) nodes.push({ text: code, style: 'code' });
        i = end + 1;
        continue;
      }
      // An unterminated fence is not a code block — fall through to prose, which
      // is what the reader saw on the page.
    }

    const heading = HEADING.exec(line);
    if (heading) {
      nodes.push({ text: renderInline(heading[2].trim(), {}), style: `h${heading[1].length}` });
      i++;
      continue;
    }

    if (HR.test(line)) {
      nodes.push(horizontalRule());
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      let end = i;
      while (end < lines.length && QUOTE.test(lines[end])) end++;
      const inner = lines.slice(i, end).map((l) => l.replace(QUOTE, ''));
      const content = renderBlocks(inner);
      if (content.length > 0) nodes.push(quoteNode(content));
      i = end;
      continue;
    }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      let end = i + 2;
      while (end < lines.length && TABLE_ROW.test(lines[end])) end++;
      const rows = [lines[i], ...lines.slice(i + 2, end)].map(splitCells);
      const table = tableNode(rows);
      if (table) nodes.push(table);
      i = end;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const end = listBlockEnd(lines, i);
      const list = listNode(lines.slice(i, end));
      if (list) nodes.push(list);
      i = end;
      continue;
    }

    // Paragraph: run on until a blank line or the start of another block. Soft line
    // breaks inside it (the serializer's `<br>` → `\n`) stay inside the one node.
    let end = i + 1;
    while (end < lines.length && lines[end].trim() !== '' && !startsBlock(lines, end)) end++;
    const text = lines.slice(i, end).join('\n').trim();
    if (text.length > 0) nodes.push({ text: renderInline(text, {}), margin: [0, 2, 0, 2] });
    i = end;
  }
  return nodes;
}

// Whether the line at `idx` opens a block, used to close an open paragraph. A table
// needs its divider on the following line, mirroring the check in renderBlocks.
function startsBlock(lines: string[], idx: number): boolean {
  const line = lines[idx];
  return (
    FENCE_OPEN.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    (TABLE_ROW.test(line) && idx + 1 < lines.length && TABLE_DIVIDER.test(lines[idx + 1]))
  );
}

// Index of the closing fence for the fence opened at `start`, or -1 when the block
// is never closed. The serializer widens the fence past the longest backtick run in
// the body, so the closing run must be at least as long as the opening one.
function findFenceEnd(lines: string[], start: number, length: number): number {
  const close = new RegExp(`^[ \\t]*\`{${length},}[ \\t]*$`);
  for (let i = start + 1; i < lines.length; i++) {
    if (close.test(lines[i])) return i;
  }
  return -1;
}

// ------------------------------------------------------------------ list layer

// Leading-whitespace width of a line (tab counted as one column — the serializer
// indents with spaces only).
function indentWidth(line: string): number {
  return line.length - line.replace(/^[ \t]*/, '').length;
}

// End (exclusive) of the list block starting at `start`: sibling markers at the same
// indent, anything indented deeper (nested lists, continuation blocks), and the blank
// lines separating those from the next deeper line.
function listBlockEnd(lines: string[], start: number): number {
  const base = indentWidth(lines[start]);
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      let j = i;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && indentWidth(lines[j]) > base) {
        i = j;
        continue;
      }
      break;
    }
    if (indentWidth(line) > base) {
      i++;
      continue;
    }
    if (indentWidth(line) === base && LIST_ITEM.test(line)) {
      i++;
      continue;
    }
    break;
  }
  return i;
}

function listNode(lines: string[]): Content | null {
  const base = indentWidth(lines[0]);
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '' && indentWidth(lines[i]) === base && LIST_ITEM.test(lines[i])) {
      starts.push(i);
    }
  }
  if (starts.length === 0) return null;

  const items: Content[] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const marker = LIST_ITEM.exec(lines[from]);
    const width = marker ? marker[0].length : base;
    const body = [
      lines[from].slice(width),
      ...lines.slice(from + 1, to).map((l) => dedent(l, width)),
    ];
    const content = renderBlocks(body);
    if (content.length === 0) continue;
    items.push(content.length === 1 ? content[0] : { stack: content });
  }
  if (items.length === 0) return null;

  const first = lines[starts[0]].trim();
  const ordered = /^\d/.test(first);
  if (!ordered) return { ul: items, margin: [0, 2, 0, 2] };
  const start = Number.parseInt(first, 10);
  const node: Content = { ol: items, margin: [0, 2, 0, 2] };
  // pdfmake numbers from 1 by default; carry an explicit start only when the
  // serializer read a different one off `<ol start="N">`.
  if (Number.isFinite(start) && start !== 1) (node as { start?: number }).start = start;
  return node;
}

// Drop up to `width` columns of leading whitespace — the continuation indent the
// serializer aligned to the marker width. A shallower line keeps what it has.
function dedent(line: string, width: number): string {
  let cut = 0;
  while (cut < width && cut < line.length && (line[cut] === ' ' || line[cut] === '\t')) cut++;
  return line.slice(cut);
}

// ----------------------------------------------------------------- table layer

// Split a GFM row on its unescaped `|` delimiters. A literal pipe from page text is
// already `\|` at the source (escapeMarkdownText), so a backslash-preceded pipe is
// content, not a delimiter. The empty cells the outer pipes produce are dropped.
function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      cur += ch + line[i + 1];
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

function tableNode(rows: string[][]): Content | null {
  const cols = Math.max(...rows.map((r) => r.length));
  if (!Number.isFinite(cols) || cols === 0) return null;
  const body: TableCell[][] = rows.map((cells, rowIndex) => {
    const row: TableCell[] = [];
    for (let c = 0; c < cols; c++) {
      const text = renderInline(cells[c] ?? '', {});
      row.push(rowIndex === 0 ? { text, style: 'tableHeader' } : { text });
    }
    return row;
  });
  return {
    table: { headerRows: 1, widths: Array<string>(cols).fill('*'), body },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 4],
  };
}

// ------------------------------------------------------------ decoration nodes

// A blockquote is a single-cell table whose only rule is the left bar, which is how
// pdfmake draws a vertical accent without a custom plugin. One shared constant so two
// renders of the same body stay deep-equal (the determinism contract) — layouts are
// read by pdfmake, unlike the content nodes below, which it mutates.
const QUOTE_LAYOUT = {
  hLineWidth: () => 0,
  vLineWidth: (i: number) => (i === 0 ? 2 : 0),
  vLineColor: () => '#d0d7de',
  paddingLeft: () => 8,
  paddingRight: () => 0,
  paddingTop: () => 0,
  paddingBottom: () => 0,
};

function horizontalRule(): Content {
  return {
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#d0d7de' }],
    margin: [0, 6, 0, 6],
  };
}

function quoteNode(content: Content[]): Content {
  return {
    table: { widths: ['*'], body: [[{ stack: content }]] },
    layout: QUOTE_LAYOUT,
    margin: [0, 4, 0, 4],
  };
}

// `---` renders as a hairline the width of the text column (A4 minus the 40pt page
// margins declared in pdf.ts). A FRESH node per rule, never a shared constant: the
// layout engine writes bookkeeping (`_margin`, measured sizes) onto every content
// node it walks, so a shared — let alone frozen — node throws at export time while
// every doc-definition assertion still passes.

// --------------------------------------------------------------- inline layer

// An inline-code span anchored at the scan position: N backticks, a body, then a
// closing run of at least N. The scan below consumes backslash escapes before
// testing, so an escaped backtick can never open or close a span.
const INLINE_CODE_AT = /(`+)([^\n]*?)(?<![\\`])\1(?!`)/y;
const STRONG_AT = /\*\*(?=\S)([^\n]*?\S)\*\*/y;
const EM_AT = /\*(?=[^\s*])([^\n*]*[^\s*])\*(?!\*)/y;

// CommonMark backslash escape: a backslash plus ASCII punctuation.
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g;

/**
 * Render an inline run. Returns a plain string when nothing in it is styled, which
 * keeps the common node shape (and the existing document definitions) unchanged;
 * otherwise an array of pdfmake text runs carrying bold/italics/link/code styling.
 */
export function renderInline(text: string, marks: Marks): string | Content[] {
  const { runs, styled, changed } = renderRuns(text, marks);
  if (!styled && !changed) return unescapeMarkdown(text);
  return runs;
}

interface InlineResult {
  runs: Content[];
  /** A run carries styling (code/link/emphasis) — the caller cannot fall back to a plain string. */
  styled: boolean;
  /** Markup was dropped (an image), so the source text is no longer what should show. */
  changed: boolean;
}

// Single left-to-right scan. Delimiters are tested in the order the grammar nests
// them — escape, code, image, link, strong, em — and anything that fails to pair is
// consumed as literal text, which is what the source page showed.
function renderRuns(text: string, marks: Marks): InlineResult {
  const runs: Content[] = [];
  let buf = '';
  let styled = false;
  let changed = false;
  const flush = (): void => {
    if (buf.length === 0) return;
    runs.push(run(unescapeMarkdown(buf), marks));
    buf = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // A backslash escape is copied through untouched: it is not a delimiter, and
    // unescapeMarkdown strips it when the surrounding chunk is flushed.
    if (ch === '\\' && i + 1 < text.length) {
      buf += ch + text[i + 1];
      i += 2;
      continue;
    }

    if (ch === '`') {
      INLINE_CODE_AT.lastIndex = i;
      const code = INLINE_CODE_AT.exec(text);
      const body = code ? stripCodePadding(code[2]) : '';
      if (code && body.length > 0) {
        flush();
        runs.push(run(body, marks, 'inlineCode'));
        styled = true;
        i = INLINE_CODE_AT.lastIndex;
        continue;
      }
    }

    if (ch === '!' && text[i + 1] === '[') {
      const image = matchImage(text, i);
      if (image) {
        // No image can be fetched into the PDF (Golden Principle #1: nothing local
        // leaves and nothing remote is pulled in), so the markup is dropped and the
        // alt text — the only thing the reader can act on — is kept.
        buf += image.alt;
        changed = true;
        i = image.end;
        continue;
      }
    }

    if (ch === '[') {
      const link = matchLink(text, i);
      if (link) {
        flush();
        runs.push(...renderRuns(link.text, { ...marks, link: link.href }).runs);
        styled = true;
        i = link.end;
        continue;
      }
    }

    if (ch === '*') {
      const strong = matchDelimited(text, i, STRONG_AT);
      if (strong) {
        flush();
        runs.push(...renderRuns(strong.body, { ...marks, bold: true }).runs);
        styled = true;
        i = strong.end;
        continue;
      }
      const em = matchDelimited(text, i, EM_AT);
      if (em) {
        flush();
        runs.push(...renderRuns(em.body, { ...marks, italics: true }).runs);
        styled = true;
        i = em.end;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return { runs, styled, changed };
}

// Build one pdfmake text run, adding a styling key only when it applies — an
// unstyled run stays the bare `{ text }` shape the exporter has always emitted.
function run(text: string, marks: Marks, codeStyle?: 'inlineCode'): Content {
  const node: {
    text: string;
    bold?: true;
    italics?: true;
    link?: string;
    style?: string | string[];
  } = { text };
  if (marks.bold) node.bold = true;
  if (marks.italics) node.italics = true;
  const styles: string[] = [];
  if (codeStyle) styles.push(codeStyle);
  if (marks.link !== undefined) {
    node.link = marks.link;
    styles.push('link');
  }
  if (styles.length === 1) node.style = styles[0];
  else if (styles.length > 1) node.style = styles;
  return node;
}

interface Delimited {
  body: string;
  end: number;
}

function matchDelimited(text: string, at: number, re: RegExp): Delimited | null {
  re.lastIndex = at;
  const match = re.exec(text);
  if (!match) return null;
  return { body: match[1], end: re.lastIndex };
}

interface Link {
  text: string;
  href: string;
  end: number;
}

// `[text](href)` anchored at `at`. The label may itself contain a nested image
// (`[![](favicon)Label](url)` — the shape ChatGPT citations serialize to), so
// brackets are matched by depth; the href is scanned with paren depth so a URL
// containing `(`/`)` survives. Returns null when either half is unterminated, which
// leaves the brackets as the literal text they were.
function matchLink(text: string, at: number): Link | null {
  const close = matchBracket(text, at, '[', ']');
  if (close === -1 || text[close + 1] !== '(') return null;
  const label = text.slice(at + 1, close);
  const hrefEnd = matchBracket(text, close + 1, '(', ')');
  if (hrefEnd === -1) return null;
  const href = text.slice(close + 2, hrefEnd).trim();
  if (href.length === 0) return null;
  // A label that renders to nothing — an image-only citation label, an empty pair —
  // would leave an invisible link, so the href itself becomes the visible text.
  const visible = renderRuns(label, {})
    .runs.map((r) => (r as { text?: string }).text ?? '')
    .join('')
    .trim();
  return { text: visible.length > 0 ? label : href, href, end: hrefEnd + 1 };
}

interface Image {
  alt: string;
  end: number;
}

// `![alt](src)` anchored at `at` (the `!`).
function matchImage(text: string, at: number): Image | null {
  const close = matchBracket(text, at + 1, '[', ']');
  if (close === -1 || text[close + 1] !== '(') return null;
  const srcEnd = matchBracket(text, close + 1, '(', ')');
  if (srcEnd === -1) return null;
  return { alt: text.slice(at + 2, close), end: srcEnd + 1 };
}

// Index of the delimiter closing the one at `open`, honouring nesting and skipping
// backslash-escaped delimiters; -1 when it is never closed.
function matchBracket(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// CommonMark: one leading and one trailing space are stripped from a code span when
// both are present and the body is not all spaces — the padding the serializer adds
// so a body touching a backtick stays parseable.
function stripCodePadding(body: string): string {
  if (body.length >= 2 && body.startsWith(' ') && body.endsWith(' ') && body.trim().length > 0) {
    return body.slice(1, -1);
  }
  return body;
}

/**
 * Undo the escaping `escapeMarkdownText` applied upstream. That pass exists so the
 * *Markdown* export stays valid source; this renderer renders prose instead — it
 * drops the fences, the backticks and the emphasis markers — so a surviving
 * backslash is punctuation the source page never showed (`a \` b`, `\[1\]`, `\|`,
 * `\*`). Applied ONLY to prose runs: code bodies, inline and fenced, are never
 * escaped in the first place (src/core/markdown-escape.ts), so unescaping them would
 * eat a real backslash out of a regex or a Windows path. A single left-to-right pass,
 * which is what makes the doubled backslash the escaper emits first (`C:\path` →
 * `C:\\path`) round-trip to one rather than exposing the character it protects.
 */
function unescapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_ESCAPE, '$1');
}
