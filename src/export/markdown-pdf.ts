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
  /**
   * This text is one table cell. Not styling — it rides on `Marks` because that is
   * what already propagates into every nested inline render (a link label, an
   * emphasis body), which is exactly where a code span inside a cell can appear. Read
   * only by the code-span branch; `run()` ignores it.
   */
  cell?: true;
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
// Only the `---` form: that is the one `serializeBlockElement` emits for an `<hr>`.
// The `___` spelling had to go — `escapeMarkdownText` escapes a line-leading `-`, `*`
// and `+`, but a non-flanking `_` is left alone, so a literal `___` line of page text
// arrived here bare and was silently replaced by a drawn rule. (`***` was never at
// risk: a leading `*` IS escaped. It is dropped only because nothing emits it.)
const HR = /^ {0,3}-{3,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const FENCE_OPEN = /^[ \t]*(`{3,})/;
// A list item marker. The trailing whitespace is OPTIONAL because the serializer
// emits a marker on its own line twice (html-to-markdown `serializeListItem`): for an
// empty `<li>`, and for an `<li>` whose first content is a nested list. Requiring the
// space there broke the list in two and printed the bare marker as prose — the exact
// leaked marker this renderer exists to remove.
const LIST_ITEM = /^([ \t]*)([-*+]|\d+[.)])([ \t]+|[ \t]*$)/;
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
      const text = renderInline(heading[2].trim(), {});
      if (!isEmptyInline(text)) nodes.push({ text, style: `h${heading[1].length}` });
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
      if (table) {
        nodes.push(table);
        i = end;
        continue;
      }
      // No row split into a single cell — the shape a row that is nothing but `|`
      // produces — so there is no grid to draw. Dropping the block is the silent empty
      // output Golden Principle #4 rules out, so fall through to prose. The delimiter
      // row is layout, not content, and is left out the same way `rows` leaves it out.
      const source = [lines[i], ...lines.slice(i + 2, end)].join('\n').trim();
      const fallback = renderInline(source, {});
      if (!isEmptyInline(fallback)) nodes.push({ text: fallback, margin: [0, 2, 0, 2] });
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
    const source = lines.slice(i, end).join('\n').trim();
    const text = renderInline(source, {});
    // Emptiness is judged on the RENDERED runs, not the source line: a paragraph
    // holding only an image with no alt text has non-empty Markdown and nothing to
    // show, and a blank block on the page is the silent output Golden Principle #4
    // rules out.
    if (!isEmptyInline(text)) nodes.push({ text, margin: [0, 2, 0, 2] });
    i = end;
  }
  return nodes;
}

// Whether an inline render came out with nothing to show — an empty string, or runs
// that all carry empty text.
function isEmptyInline(text: string | Content[]): boolean {
  if (typeof text === 'string') return text.trim().length === 0;
  return text.every((node) => ((node as { text?: string }).text ?? '').trim().length === 0);
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
    // Continuation lines are indented to the marker's FULL width — including the
    // space that follows it — so a bare marker still dedents by that implied space.
    const width = marker
      ? marker[1].length + marker[2].length + Math.max(marker[3].length, 1)
      : base;
    const body = [
      lines[from].slice(width),
      ...lines.slice(from + 1, to).map((l) => dedent(l, width)),
    ];
    const content = renderBlocks(body);
    // An empty `<li>` keeps its marker: dropping the item would renumber every
    // ordered sibling after it and lose a bullet the page showed.
    if (content.length === 0) items.push({ text: '' });
    else items.push(content.length === 1 ? content[0] : { stack: content });
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

/**
 * Undo the delimiter escaping `escapeCellPipes` (src/core/html-to-markdown.ts) applied
 * to a code body inside a table cell — its exact inverse, and the two must move
 * together. A run of `2n` backslashes followed by `\|` was `n` backslashes and a
 * literal pipe on the page; every other backslash is content and is left alone,
 * because a code body is literal text and nothing else in it was ever escaped.
 *
 * Prose in a cell is NOT put through this: it carries escapeMarkdownText's own
 * convention and is undone by `unescapeMarkdown` on the prose runs, as it always was.
 */
function unescapeCellCode(body: string): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    if (body[i] === '\\') {
      let end = i;
      while (end < body.length && body[end] === '\\') end++;
      const run = end - i;
      if (body[end] === '|' && run % 2 === 1) {
        out += '\\'.repeat((run - 1) / 2) + '|';
        i = end + 1;
      } else {
        out += '\\'.repeat(run);
        i = end;
      }
      continue;
    }
    out += body[i];
    i++;
  }
  return out;
}

function tableNode(rows: string[][]): Content | null {
  const cols = Math.max(...rows.map((r) => r.length));
  if (!Number.isFinite(cols) || cols === 0) return null;
  const body: TableCell[][] = rows.map((cells, rowIndex) => {
    const row: TableCell[] = [];
    for (let c = 0; c < cols; c++) {
      const text = renderInline(cells[c] ?? '', { cell: true });
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
      const raw = code ? stripCodePadding(code[2]) : '';
      const body = marks.cell ? unescapeCellCode(raw) : raw;
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
        const linkMarks = { ...marks, link: link.href };
        if (link.literal) runs.push(run(link.text, linkMarks));
        else runs.push(...renderRuns(link.text, linkMarks).runs);
        styled = true;
        i = link.end;
        continue;
      }
    }

    if (ch === '*') {
      const emphasis = matchEmphasis(text, i);
      if (emphasis) {
        flush();
        runs.push(...renderRuns(emphasis.body, { ...marks, ...emphasis.marks }).runs);
        styled = true;
        i = emphasis.end;
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

interface Emphasis {
  body: string;
  end: number;
  marks: Marks;
}

/**
 * An emphasis span opened at `at`: `*em*`, `**strong**` or `***both***`.
 *
 * A scan rather than a regex, because the shapes a flat pattern cannot express are
 * all shapes the serializer emits. `*a **b** c*` (an `<em>` wrapping a `<strong>`)
 * needs the inner span skipped WHOLE, or its closer ends the outer one; `***x***`
 * needs the opening run measured as a whole, or a lazy `**` pattern pairs it with the
 * first two of the closing three and bolds a literal `*` into the text; and
 * `**a***b*` (two adjacent elements) needs one run to both close and open.
 *
 * The body may span a newline: `<br>` inside a `<strong>` serializes to a literal
 * `\n` between the delimiters, and a paragraph keeps that soft break in one node,
 * so refusing to pair across it left `**` on the page. Blank lines end the
 * paragraph upstream of here, so this cannot pair across blocks.
 *
 * Flanking is approximated the way the emitted grammar needs it: the body may not
 * start or end with whitespace, which is what keeps prose like `2 * 3 * 4` literal.
 */
function matchEmphasis(text: string, at: number): Emphasis | null {
  let run = 0;
  while (text[at + run] === '*') run++;
  // Runs past three carry no additional meaning here — redundantly nested identical
  // tags (`<strong>a<strong>b</strong></strong>` → `**a**b****`) serialize to
  // ambiguous Markdown that no reading recovers, so the extra delimiters stay text.
  const width = Math.min(run, 3);
  const bodyStart = at + width;
  if (bodyStart >= text.length || /\s/.test(text[bodyStart])) return null;

  // Walk to the closer. A run of asterisks closes this span when the character
  // before it is not whitespace (CommonMark's right-flanking test) and the run is at
  // least as wide as the opener — consuming only `width` of it, which is what splits
  // the merged run two adjacent elements produce (`<strong>a</strong><em>b</em>` →
  // `**a***b*`: the three asterisks close the strong and open the em).
  //
  // A run that cannot close here is an inner opener, so the scan skips the span it
  // opens WHOLE rather than stepping over the delimiter alone. That is what keeps
  // `*a **b** c*` (an `<em>` wrapping a `<strong>`) nesting: the `**` after `b` is a
  // legal closer by width, and without the skip the italic would end there. Searching
  // for an exact-width closer instead is not a substitute — it reaches past the
  // adjacent case into a LATER run of the same width (`**a***b* **c**` swallowed
  // everything up to the closer of `**c**`).
  let i = bodyStart;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    // An asterisk inside a code span, a URL or an image source is content, not a
    // delimiter: `**a `x*y` b**` used to consume the code span's `*` as a nested
    // opener, eat the real closer and spill both the backticks and the `**` onto the
    // page. Atoms are skipped whole, in the same precedence renderRuns uses.
    const atom = skipInlineAtom(text, i);
    if (atom !== -1) {
      i = atom;
      continue;
    }
    if (text[i] !== '*') {
      i++;
      continue;
    }
    let closing = 0;
    while (text[i + closing] === '*') closing++;
    if (closing >= width && !/\s/.test(text[i - 1])) {
      const body = text.slice(bodyStart, i);
      // A body of nothing but asterisks is not emphasis, it is an ASCII divider the
      // page showed (`**********`, which the escaper protects only at its first
      // character). Pairing there silently ate most of the line.
      if (!/[^*]/.test(body)) return null;
      return { body, end: i + width, marks: EMPHASIS_MARKS[width] };
    }
    const nested = matchEmphasis(text, i);
    i = nested ? nested.end : i + closing;
  }
  return null;
}

/**
 * End of the inline atom starting at `i` — a code span, an image or a link — or -1
 * when no atom starts there. Used by the emphasis scan to step over regions whose
 * asterisks are content; the atoms themselves are parsed by `renderRuns`.
 */
function skipInlineAtom(text: string, i: number): number {
  if (text[i] === '`') {
    INLINE_CODE_AT.lastIndex = i;
    const code = INLINE_CODE_AT.exec(text);
    if (code && stripCodePadding(code[2]).length > 0) return INLINE_CODE_AT.lastIndex;
  }
  if (text[i] === '!' && text[i + 1] === '[') {
    const image = matchImage(text, i);
    if (image) return image.end;
  }
  if (text[i] === '[') {
    const link = matchLink(text, i);
    if (link) return link.end;
  }
  return -1;
}

// Opening-run width → the styling it carries. Three is `***both***`, the shape a
// `<strong>` wrapping an `<em>` (or the reverse) serializes to.
const EMPHASIS_MARKS: Record<number, Marks> = {
  1: { italics: true },
  2: { bold: true },
  3: { bold: true, italics: true },
};

interface Link {
  text: string;
  href: string;
  end: number;
  /** The text is the href standing in for an invisible label — show it as it is. */
  literal?: true;
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
  const angle = matchAngleDestination(text, close + 2);
  const hrefEnd = angle ? angle.end : matchBracket(text, close + 1, '(', ')');
  if (hrefEnd === -1) return null;
  const href = angle ? angle.href : text.slice(close + 2, hrefEnd).trim();
  if (href.length === 0) return null;
  // A label that renders to nothing — an image-only citation label, an empty pair —
  // would leave an invisible link, so the href itself becomes the visible text.
  const visible = renderRuns(label, {})
    .runs.map((r) => (r as { text?: string }).text ?? '')
    .join('')
    .trim();
  if (visible.length > 0) return { text: label, href, end: hrefEnd + 1 };
  // The href is displayed text now, not Markdown: re-parsing it would italicize a
  // URL that happens to contain `*` and drop the characters from what is shown.
  return { text: href, href, end: hrefEnd + 1, literal: true };
}

// The CommonMark angle-bracket destination `[label](<url>)`, which the serializer
// emits for a URL holding whitespace or unbalanced parens — the shapes the bare
// paren-depth scan would truncate. Returns null unless `at` opens a wrapper that is
// closed and immediately followed by the link's `)`, so a literal `<` in an ordinary
// destination still falls through to the bare scan. `end` is the index of that `)`,
// matching what `matchBracket` returns.
function matchAngleDestination(text: string, at: number): { href: string; end: number } | null {
  if (text[at] !== '<') return null;
  const close = text.indexOf('>', at + 1);
  if (close === -1 || text[close + 1] !== ')') return null;
  return { href: text.slice(at + 1, close).trim(), end: close + 1 };
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
