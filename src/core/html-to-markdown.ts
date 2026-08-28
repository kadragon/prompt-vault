// Converts an assistant turn's rendered prose subtree back into GitHub-flavored
// Markdown. This is where the DOM→Markdown normalization happens so that exporters
// consume only the Conversation model and never touch the DOM (docs/conventions.md).
// Output is deterministic: same subtree → same string. Scope is the standard tags
// chat providers emit: headings, p, strong/em, inline & fenced code, ul/ol/li, a,
// table, blockquote, hr, br, img.
//
// Provider-agnostic on purpose, and therefore in core rather than in an adapter:
// every adapter hands it a *different* container (ChatGPT's `.markdown`, Claude's
// `.standard-markdown`) but the same ordinary rendered HTML inside. Adapter isolation
// (AGENTS.md #3) bans the alternative — one adapter importing another's module. Nothing
// here may reference a provider-specific selector, class, or attribute.

import { escapeMarkdownText } from './markdown-escape';

/** Serialize a prose *container* — its block children become the Markdown blocks. */
export function htmlToMarkdown(root: Element): string {
  return normalize(serializeBlocks(root, 0));
}

/**
 * Serialize a single block element — the element ITSELF, not just its children. Use this
 * when the element to render is the block, e.g. a `<ul>` lifted out of a user turn:
 * `htmlToMarkdown` would treat that `<ul>` as a container and serialize its `<li>`s as
 * separate blocks, silently dropping the list markers.
 */
export function blockToMarkdown(el: Element): string {
  return normalize(serializeBlockElement(el, 0));
}

/** Collapse 3+ blank lines and trim outer whitespace, for stable output. */
function normalize(md: string): string {
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
      // An ATX heading is a single line by definition, so a `<br>` inside one is
      // flattened rather than emitted as a second line — the same treatment
      // `serializeTableCell` gives its inline-only context. Emitting the break split
      // the heading into a heading plus a stray paragraph, and tore any emphasis
      // spanning it in half, leaving `**` visible.
      return '#'.repeat(Number(tag[1])) + ' ' + serializeInline(el).replace(/\n+/g, ' ').trim();
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
 * Recursively unwrap a layout wrapper (a div/section that is not itself a
 * list-block tag but contains block descendants) into its child nodes, so its
 * block children partition as real blocks in document order. A wrapper whose
 * first block child is a nested list would otherwise be serialized as a single
 * `list: false` block and collide the two markers (`- - child`); unwrapping lets
 * that list hit the tight nested-list branch instead. Non-wrappers (list-block
 * tags, and inline-only elements with no block child) pass through untouched.
 */
function flattenListItemNodes(node: Node): Node[] {
  if (node.nodeType !== NODE_ELEMENT) {
    return [node];
  }
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (LIST_BLOCK_TAGS.includes(tag) || !hasBlockChild(el)) {
    return [node];
  }
  const flat: Node[] = [];
  for (const child of Array.from(el.childNodes)) {
    flat.push(...flattenListItemNodes(child));
  }
  return flat;
}

/**
 * Serialize one <li>. Layout wrappers are unwrapped first (see
 * `flattenListItemNodes`), then content is partitioned into document-order
 * segments — runs of inline nodes vs. individual block children — so block
 * structure survives. The first segment shares the marker line; later segments
 * become continuation blocks indented to the marker width, blank-line separated.
 * A nested list is the exception: it is indented to the marker width (`cont`) and
 * emitted tight (matching the historical `- parent\n  - child` output).
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

  const flatNodes = Array.from(li.childNodes).flatMap(flattenListItemNodes);

  for (const node of flatNodes) {
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

// A table cell is inline-only in Markdown: flatten to a single line. A literal `|`
// from a text node is already escaped at the source by escapeMarkdownText, but a code
// body is deliberately never escaped, so `<td><code>a|b</code></td>` still reaches
// here holding a bare delimiter that would split the row. GFM requires the pipe
// escaped even inside code when the code is inside a table, so the cell-level pass
// below finishes the job — backslash-aware, so an already-escaped pipe is left alone.
function serializeTableCell(cell: Element): string {
  return escapeBarePipes(serializeInline(cell).replace(/\n+/g, ' ').trim());
}

// Backslash-escape every `|` that is not already escaped. The scan consumes
// backslash pairs the way the reader will, so `\|` (escaped pipe) and `\\` (escaped
// backslash) both survive a second pass unchanged.
function escapeBarePipes(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      out += ch + text[i + 1];
      i++;
      continue;
    }
    out += ch === '|' ? '\\|' : ch;
  }
  return out;
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
 * The fence's language hint, read from whichever of the two conventions the provider
 * uses:
 *
 * 1. The standard `<code class="language-xxx">` tag. Claude uses this (verified against
 *    the live page 2026-07-25: `class="language-sql"`), as does anything rendering
 *    through a CommonMark/highlight.js pipeline. Checked first because it is an explicit
 *    machine-readable declaration rather than an inference from display text.
 * 2. A label rendered in the code-block header (e.g. "Python"). ChatGPT does this and
 *    tags no class, so the label is read from the header text with the `<code>`, buttons,
 *    and icons stripped out.
 *
 * Either way the result must look like a language token: non-language labels (localized
 * status text, a "Copy" caption) fail the ascii check and yield no language rather than a
 * bogus one — also the correct outcome for a provider whose header carries no label.
 */
function codeLanguage(pre: Element): string {
  const tagged = languageFromClass(pre.querySelector('code'));
  if (tagged) return tagged;

  const clone = pre.cloneNode(true) as Element;
  clone.querySelectorAll('code, button, svg').forEach((n) => n.remove());
  const token = (clone.textContent ?? '').trim().split(/\s+/)[0] ?? '';
  return asLanguageToken(token);
}

/** The `language-xxx` class on a `<code>`, or `''` when it carries none. */
function languageFromClass(code: Element | null): string {
  if (!code) return '';
  // `className` is not a string on SVG/unknown elements in every DOM implementation,
  // so read the attribute, which is always a string when present.
  const classes = (code.getAttribute('class') ?? '').split(/\s+/);
  for (const name of classes) {
    if (!name.startsWith('language-')) continue;
    const lang = asLanguageToken(name.slice('language-'.length));
    if (lang) return lang;
  }
  return '';
}

/** Normalize a candidate to a lowercase language token, or `''` if it is not one. */
function asLanguageToken(raw: string): string {
  const lang = raw.toLowerCase();
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
  for (let idx = 0; idx < nodes.length; idx++) {
    const node = nodes[idx];
    if (node.nodeType === NODE_TEXT) {
      // A text node is at a line start when it is the first content emitted in this
      // inline run, or when the run so far ended with a newline (a `<br>` — the text
      // after it genuinely begins a line, and an unescaped `- ` there is read back as
      // a real bullet by any renderer that parses this Markdown). A run after an
      // inline element (`**bold** - x`) is mid-line, so its leading marker must not
      // be escaped as a block marker.
      // Classify edge delimiters against their real neighbor across inline-element
      // boundaries: `prevChar` is the last visible char of the preceding siblings,
      // `nextChar` the first visible char of the following siblings.
      const prevChar = lastVisibleChar(nodes, idx - 1, skip);
      const nextChar = firstVisibleChar(nodes, idx + 1, skip);
      const atLineStart = out === '' || out.endsWith('\n');
      out += escapeMarkdownText(collapseWs(node.textContent ?? ''), atLineStart, prevChar, nextChar);
      continue;
    }
    if (node.nodeType !== NODE_ELEMENT) continue;
    const child = node as Element;
    if (skip?.has(child)) continue;
    if (child.tagName.toLowerCase() === 'code') {
      // Two `<code>` siblings with nothing between them have no two-span spelling in
      // Markdown: `` `k` `` followed by `` `k` `` reads back as ONE span whose body is
      // ``k``, and no fence length repairs it (CommonMark pairs backtick runs of equal
      // length, so a longer fence on either side fails to close at all). On the page
      // they are one continuous run of code text, so emit one span holding both bodies.
      const merged = mergeAdjacentCode(nodes, idx, skip);
      out += inlineCode(merged.body);
      idx = merged.last;
      continue;
    }
    out += serializeInlineElement(child);
  }
  return out;
}

// Concatenate the run of `<code>` siblings starting at `from`, returning the joined
// body and the index of the last one consumed. Only siblings with nothing visible
// between them merge: an empty text node is transparent, but real text (`<code>a</code>
// <code>b</code>`) separates the spans and ends the run.
function mergeAdjacentCode(
  nodes: Node[],
  from: number,
  skip?: Set<Element>,
): { body: string; last: number } {
  let body = (nodes[from] as Element).textContent ?? '';
  let last = from;
  for (let k = from + 1; k < nodes.length; k++) {
    const next = nodes[k];
    if (next.nodeType === NODE_TEXT && (next.textContent ?? '') === '') continue;
    if (next.nodeType !== NODE_ELEMENT) break;
    const el = next as Element;
    if (skip?.has(el) || el.tagName.toLowerCase() !== 'code') break;
    body += el.textContent ?? '';
    last = k;
  }
  return { body, last };
}

// First visible flow character at or after index `from` in `nodes`, skipping
// `skip`-set elements, used to classify a delimiter at a text-node edge against
// its real neighbor. A leading whitespace char collapses to `' '` (a whitespace
// neighbor); `' '` is also returned when no further visible content follows.
function firstVisibleChar(nodes: Node[], from: number, skip?: Set<Element>): string {
  for (let k = from; k < nodes.length; k++) {
    const n = nodes[k];
    if (n.nodeType === NODE_ELEMENT && skip?.has(n as Element)) continue;
    const text = n.textContent ?? '';
    if (text.length === 0) continue;
    return /\s/.test(text[0]) ? ' ' : text[0];
  }
  return ' ';
}

// Last visible flow character at or before index `from` in `nodes`, skipping
// `skip`-set elements, used to classify a delimiter at a text-node edge against
// its real neighbor. A trailing whitespace char collapses to `' '`.
function lastVisibleChar(nodes: Node[], from: number, skip?: Set<Element>): string {
  for (let k = from; k >= 0; k--) {
    const n = nodes[k];
    if (n.nodeType === NODE_ELEMENT && skip?.has(n as Element)) continue;
    const text = n.textContent ?? '';
    if (text.length === 0) continue;
    const lastChar = text[text.length - 1];
    return /\s/.test(lastChar) ? ' ' : lastChar;
  }
  return ' ';
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
      return href ? `[${text}](${linkDestination(href)})` : text;
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

// A bare link destination is read up to the first unbalanced `)`, so a URL holding
// one (`…/a)b`) is silently truncated by any CommonMark parser, this project's PDF
// renderer included. Whitespace has the same problem. CommonMark provides the
// angle-bracket form for exactly these, so wrap when the destination needs it.
function linkDestination(href: string): string {
  const needsWrap = /\s/.test(href) || !hasBalancedParens(href);
  // A `<` or `>` inside the destination would close the wrapper early — such a URL
  // has no valid spelling either way, so leave it bare rather than corrupt it.
  if (!needsWrap || /[<>]/.test(href)) return href;
  return `<${href}>`;
}

function hasBalancedParens(href: string): boolean {
  let depth = 0;
  for (const ch of href) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

// Wrap inline code, choosing a backtick fence longer than any run inside the text
// and padding with a space when the content starts/ends with a backtick, per
// CommonMark — so code containing backticks stays valid Markdown.
function inlineCode(text: string): string {
  // A code span occupies one line: a newline in the body would leave the closing
  // fence on a later line, where nothing pairs it (the PDF renderer deliberately
  // refuses to — test/export/pdf.test.ts) and the backticks survive as literal text.
  // Collapse the way every other inline path already does, at the source.
  const body = collapseWs(text);
  const longestRun = longestBacktickRun(body);
  const fence = '`'.repeat(longestRun + 1);
  const pad = longestRun > 0 ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
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
