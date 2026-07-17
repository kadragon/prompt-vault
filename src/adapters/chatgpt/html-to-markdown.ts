// Converts the assistant's rendered `.markdown` HTML subtree back into
// GitHub-flavored Markdown. This is where the DOM→Markdown normalization happens
// so that exporters (tickets 4/5) consume only the Conversation model and never
// touch the DOM (docs/conventions.md). Output is deterministic: same subtree →
// same string. Scope is limited to the tags ChatGPT actually emits (verified
// against test/fixtures/chatgpt/): headings, p, strong/em, inline & fenced code,
// ul/ol/li, a, blockquote, hr, br, img.

import { escapeMarkdownText } from '../../core/markdown-escape';

/** Serialize an assistant `.markdown` element to Markdown. */
export function htmlToMarkdown(root: Element): string {
  const md = serializeBlocks(root, 0);
  // Collapse 3+ blank lines and trim outer whitespace for stable output.
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

/** Serialize the block-level children of a container, separated by blank lines. */
function serializeBlocks(container: Element, listDepth: number): string {
  const parts: string[] = [];
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === NODE_TEXT) {
      const text = collapseWs(node.textContent ?? '');
      if (text.trim()) parts.push(escapeMarkdownText(text.trim(), true));
      continue;
    }
    if (node.nodeType !== NODE_ELEMENT) continue;
    const el = node as Element;
    parts.push(serializeBlockElement(el, listDepth));
  }
  return parts.filter((p) => p.length > 0).join('\n\n');
}

function serializeBlockElement(el: Element, listDepth: number): string {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return '#'.repeat(Number(tag[1])) + ' ' + serializeInline(el).trim();
    case 'p':
      return serializeInline(el).trim();
    case 'pre':
      return serializeCodeBlock(el);
    case 'ul':
    case 'ol':
      return serializeList(el, tag === 'ol', '  '.repeat(listDepth));
    case 'table':
      return serializeTable(el);
    case 'blockquote':
      return serializeBlocks(el, listDepth)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'hr':
      return '---';
    default:
      // Unknown wrapper (div/span/section around content): recurse so nested
      // block structure is preserved instead of dropped.
      if (hasBlockChild(el)) return serializeBlocks(el, listDepth);
      return serializeInline(el).trim();
  }
}

// `indent` is the whitespace prefix for this level's markers (`''` at top level).
// A nested list is indented to the parent marker's full width, not a fixed two
// spaces, so a wide ordered marker (`10. `) keeps its children beneath the text.
function serializeList(list: Element, ordered: boolean, indent: string): string {
  const items = Array.from(list.children).filter((c) => c.tagName.toLowerCase() === 'li');
  const start = ordered ? listStart(list) : 1;
  const lines = items.map((li, i) =>
    serializeListItem(li, ordered ? `${start + i}. ` : '- ', indent),
  );
  return lines.join('\n');
}

// Read a non-negative `start` from <ol start="N">, defaulting to 1 for a plain
// list, a negative, or an unparseable attribute (all of which are not valid
// ordered-list markers).
function listStart(list: Element): number {
  const raw = list.getAttribute('start');
  if (raw === null) return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

// Block-level tags a <li> may directly contain. Each becomes its own segment so a
// nested <pre>, extra <p>, list, or table is serialized as a real block instead
// of being flattened into the marker line.
const LIST_BLOCK_TAGS = [
  'p',
  'pre',
  'ul',
  'ol',
  'table',
  'blockquote',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
];

/**
 * Serialize one <li>. Content is partitioned into document-order segments — runs
 * of inline nodes vs. individual block children — so block structure survives.
 * The first segment shares the marker line; later segments become continuation
 * blocks indented to the marker width, blank-line separated. A nested list is the
 * exception: it is indented to the marker width (`cont`) and emitted tight
 * (matching the historical `- parent\n  - child` output).
 */
function serializeListItem(li: Element, marker: string, indent: string): string {
  const cont = indent + ' '.repeat(marker.length);

  const blocks: { lines: string[]; list: boolean }[] = [];
  let inlineRun: Node[] = [];
  const flushInline = () => {
    if (!inlineRun.length) return;
    const text = serializeInlineNodes(inlineRun).trim();
    if (text) blocks.push({ lines: text.split('\n'), list: false });
    inlineRun = [];
  };
  for (const node of Array.from(li.childNodes)) {
    const el = node.nodeType === NODE_ELEMENT ? (node as Element) : null;
    const tag = el?.tagName.toLowerCase() ?? '';
    if (el && LIST_BLOCK_TAGS.includes(tag)) {
      flushInline();
      if (tag === 'ul' || tag === 'ol') {
        // Nested list aligns under the parent marker text (cont), so it already
        // carries its indent — emitted tight and not re-prefixed below.
        const text = serializeList(el, tag === 'ol', cont);
        if (text) blocks.push({ lines: text.split('\n'), list: true });
      } else {
        const text = serializeBlockElement(el, 0);
        if (text.trim()) blocks.push({ lines: text.split('\n'), list: false });
      }
    } else {
      inlineRun.push(node);
    }
  }
  flushInline();

  if (blocks.length === 0) return indent + marker.trimEnd();

  const out: string[] = [];
  blocks.forEach((block, i) => {
    if (i === 0) {
      if (block.list) {
        // A list as the very first content: keep the marker on its own line.
        out.push(indent + marker.trimEnd());
        out.push(...block.lines);
      } else {
        out.push(indent + marker + block.lines[0]);
        for (const line of block.lines.slice(1)) out.push(line ? cont + line : '');
      }
      return;
    }
    if (block.list) {
      out.push(...block.lines);
    } else {
      out.push('');
      for (const line of block.lines) out.push(line ? cont + line : '');
    }
  });
  return out.join('\n');
}

/**
 * Serialize a <table> to a GFM table. The header row is the first <tr> (inside
 * <thead> if present, since document order puts it first); remaining <tr> are
 * body rows. `closest('table') === table` keeps a nested table's rows out of the
 * outer grid. Column count is the widest row so no cell is ever silently dropped
 * (fail-loud over the extraction principle); narrower rows are padded. Alignment
 * is not emitted (out of scope).
 */
function serializeTable(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr')).filter(
    (tr) => tr.closest('table') === table,
  );
  if (rows.length === 0) return '';
  const cellsOf = (tr: Element): string[] =>
    Array.from(tr.children)
      .filter((c) => ['td', 'th'].includes(c.tagName.toLowerCase()))
      .map(serializeTableCell);
  const grid = rows.map(cellsOf);
  const cols = Math.max(...grid.map((cells) => cells.length));
  if (cols === 0) return '';
  const row = (cells: string[]): string => {
    const padded = cells.slice(0, cols);
    while (padded.length < cols) padded.push('');
    return `| ${padded.join(' | ')} |`;
  };
  const lines = [row(grid[0]), `| ${Array(cols).fill('---').join(' | ')} |`];
  for (const cells of grid.slice(1)) lines.push(row(cells));
  return lines.join('\n');
}

// A table cell is inline-only in Markdown: flatten to a single line and escape
// `|` so cell content cannot break the grid.
function serializeTableCell(cell: Element): string {
  return serializeInline(cell)
    .replace(/\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function serializeCodeBlock(pre: Element): string {
  const code = pre.querySelector('code');
  const body = (code?.textContent ?? pre.textContent ?? '').replace(/\n+$/, '');
  const lang = codeLanguage(pre);
  // Use a fence long enough to not collide with backticks inside the code. Reduce
  // rather than spread: a huge code block can contain tens of thousands of backtick
  // runs, and `Math.max(...arr)` would overflow the call-stack arg limit.
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}

/**
 * ChatGPT does not tag the `<code>` with `language-xxx`; the language is a label
 * in the code-block header (e.g. "Python"). Read it there, ignoring the copy/run
 * buttons and icons. Non-language labels (localized status text, etc.) fail the
 * ascii-token check and yield no language rather than a bogus one.
 */
function codeLanguage(pre: Element): string {
  const clone = pre.cloneNode(true) as Element;
  clone.querySelectorAll('code, button, svg').forEach((n) => n.remove());
  const token = (clone.textContent ?? '').trim().split(/\s+/)[0] ?? '';
  const lang = token.toLowerCase();
  return /^[a-z0-9+#-]+$/.test(lang) ? lang : '';
}

/**
 * Serialize inline content. `skip` holds child elements (e.g. nested lists inside
 * an <li>) that a block-level caller handles separately and must not re-emit here.
 */
function serializeInline(el: Element, skip?: Set<Element>): string {
  return serializeInlineNodes(Array.from(el.childNodes), skip);
}

// Serialize an explicit list of sibling nodes as inline flow. Split out from
// serializeInline so a list item can serialize a subset of its children (the
// inline run between block segments) without re-wrapping them in an element.
function serializeInlineNodes(nodes: Node[], skip?: Set<Element>): string {
  let out = '';
  for (const node of nodes) {
    if (node.nodeType === NODE_TEXT) {
      // A text node is at a line start only when it is the first content emitted
      // in this inline run; a run after an inline element (`**bold** - x`) is
      // mid-line, so its leading marker must not be escaped as a block marker.
      out += escapeMarkdownText(collapseWs(node.textContent ?? ''), out === '');
      continue;
    }
    if (node.nodeType !== NODE_ELEMENT) continue;
    const child = node as Element;
    if (skip?.has(child)) continue;
    out += serializeInlineElement(child);
  }
  return out;
}

function serializeInlineElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'strong':
    case 'b':
      return `**${serializeInline(el).trim()}**`;
    case 'em':
    case 'i':
      return `*${serializeInline(el).trim()}*`;
    case 'code':
      return inlineCode(el.textContent ?? '');
    case 'a': {
      const href = el.getAttribute('href') ?? '';
      const text = serializeInline(el).trim() || href;
      return href ? `[${text}](${href})` : text;
    }
    case 'img': {
      const src = el.getAttribute('src') ?? '';
      const alt = el.getAttribute('alt') ?? '';
      return src ? `![${alt}](${src})` : '';
    }
    case 'br':
      return '\n';
    // Inline wrappers (span, etc.) and block elements that slipped into inline
    // context: recurse so their text survives.
    default:
      return serializeInline(el);
  }
}

// Wrap inline code, choosing a backtick fence longer than any run inside the text
// and padding with a space when the content starts/ends with a backtick, per
// CommonMark — so code containing backticks stays valid Markdown.
function inlineCode(text: string): string {
  const longestRun = longestBacktickRun(text);
  const fence = '`'.repeat(longestRun + 1);
  const pad = longestRun > 0 ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

// Longest run of consecutive backticks in `text`. Uses reduce (not a spread into
// Math.max) so arbitrarily large inputs can't blow the call-stack argument limit.
function longestBacktickRun(text: string): number {
  return (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
}

// True if the element contains any block-level element at any depth — not just as
// a direct child. ChatGPT often wraps a paragraph or list in intermediate <div>s,
// so a direct-children-only check would miss the block structure and flatten it
// into one inline run.
function hasBlockChild(el: Element): boolean {
  return el.querySelector('p, ul, ol, pre, table, blockquote, hr, h1, h2, h3, h4, h5, h6') !== null;
}

// Collapse runs of insignificant whitespace (including the newlines the pretty-
// printed DOM introduces) to single spaces for inline flow. Fenced code is read
// from textContent directly and never passes through here, so its formatting is
// preserved.
function collapseWs(text: string): string {
  return text.replace(/\s+/g, ' ');
}

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;
