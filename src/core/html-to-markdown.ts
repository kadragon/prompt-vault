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
// from a text node is already escaped at the source by escapeMarkdownText; a code body
// is deliberately never escaped, so the cell flag threaded through the inline path
// tells `inlineCode` to escape its own delimiters (`escapeCellPipes`). Escaping there
// rather than over the finished cell string is what keeps the two conventions apart —
// a flat pass cannot tell a backslash escapeMarkdownText added from one the page
// showed, and would eat the second.
function serializeTableCell(cell: Element): string {
  return serializeInline(cell, undefined, true).replace(/\n+/g, ' ').trim();
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
 * `inTable` says the result becomes one GFM table cell, which changes how a code
 * body is escaped — see `escapeCellPipes`.
 */
function serializeInline(el: Element, skip?: Set<Element>, inTable = false): string {
  return serializeInlineNodes(Array.from(el.childNodes), skip, inTable);
}

// Serialize an explicit list of sibling nodes as inline flow. Split out from
// serializeInline so a list item can serialize a subset of its children (the
// inline run between block segments) without re-wrapping them in an element.
function serializeInlineNodes(nodes: Node[], skip?: Set<Element>, inTable = false): string {
  const flat = flattenWrappers(nodes, skip);
  let out = '';
  // Body of a code span that has been read but not yet emitted. Two code spans with
  // nothing visible between them have no two-span spelling in Markdown: `` `k` ``
  // followed by `` `k` `` reads back as ONE span whose body is ``k``, and no fence
  // length repairs it (CommonMark pairs backtick runs of equal length, so a longer
  // fence on either side fails to close at all). On the page they are one continuous
  // run of code text, so the bodies accumulate here and flush as a single span.
  let codeBody: string | null = null;
  const flushCode = (): void => {
    if (codeBody === null) return;
    out += inlineCode(codeBody, inTable);
    codeBody = null;
  };
  for (let idx = 0; idx < flat.length; idx++) {
    const node = flat[idx];
    if (node.nodeType === NODE_TEXT) {
      // A text node is at a line start when it is the first content emitted in this
      // inline run, or when the run so far ended with a newline (a `<br>` — the text
      // after it genuinely begins a line, and an unescaped `- ` there is read back as
      // a real bullet by any renderer that parses this Markdown). A run after an
      // inline element (`**bold** - x`) is mid-line, so its leading marker must not
      // be escaped as a block marker. A pending code span counts as emitted content,
      // so it also ends the line start.
      // Classify edge delimiters against their real neighbor across inline-element
      // boundaries: `prevChar` is the last visible char of the preceding siblings,
      // `nextChar` the first visible char of the following siblings.
      const prevChar = lastVisibleChar(flat, idx - 1, skip);
      const nextChar = firstVisibleChar(flat, idx + 1, skip);
      const atLineStart = codeBody === null && (out === '' || out.endsWith('\n'));
      const text = escapeMarkdownText(
        collapseWs(node.textContent ?? ''),
        atLineStart,
        prevChar,
        nextChar,
      );
      if (text === '') continue;
      flushCode();
      out += text;
      continue;
    }
    if (node.nodeType !== NODE_ELEMENT) continue;
    const child = node as Element;
    if (skip?.has(child)) continue;
    if (child.tagName.toLowerCase() === 'code') {
      codeBody = (codeBody ?? '') + (child.textContent ?? '');
      continue;
    }
    const chunk = serializeInlineElement(child, inTable);
    // An element that renders to nothing (an empty `<strong>`) is transparent: it
    // neither emits anything nor separates two code spans that surround it.
    if (chunk === '') continue;
    flushCode();
    out += chunk;
  }
  flushCode();
  return out;
}

/**
 * Replace every wrapper element that shows the reader nothing of its own with its
 * children, recursively, so the run reads as the flat sequence the page displays.
 *
 * `serializeInlineElement` already renders such a wrapper by recursing into it, so
 * the text is identical either way — but flattening first is what lets the code-run
 * merge above see the real adjacency. A provider routinely wraps inline code in a
 * `<span>`, and `<code>k</code><span><code>k</code> x</span>` shows one continuous
 * run of code followed by text; without flattening, the span is opaque and the two
 * spans are emitted back to back as the unreadable `` `k``k` ``.
 */
function flattenWrappers(nodes: Node[], skip?: Set<Element>): Node[] {
  const out: Node[] = [];
  for (const node of nodes) {
    if (node.nodeType === NODE_ELEMENT && !skip?.has(node as Element)) {
      const el = node as Element;
      if (!MARKUP_INLINE.has(el.tagName.toLowerCase())) {
        out.push(...flattenWrappers(Array.from(el.childNodes), skip));
        continue;
      }
    }
    out.push(node);
  }
  return out;
}

/**
 * The tags `serializeInlineElement` renders with markup of its own. Everything else
 * falls through its `default` branch to its children, which is exactly the set
 * `flattenWrappers` may dissolve — so this list must move with that switch. Stated as
 * a deny-list rather than a list of wrappers because the wrappers are open-ended: a
 * provider can ship `<mark>`, `<sup>` or any other inline tag, and treating an
 * unlisted one as content would split a code run that the page showed as continuous.
 */
const MARKUP_INLINE = new Set(['strong', 'b', 'em', 'i', 'code', 'a', 'img', 'br']);

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

function serializeInlineElement(el: Element, inTable = false): string {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'strong':
    case 'b': {
      // An empty emphasis element must render as nothing, not as a bare delimiter
      // pair: `**` with no body is literal text to every reader, and between two code
      // spans it also splits a run that the page showed as continuous code.
      const body = serializeInline(el, undefined, inTable).trim();
      return body ? `**${body}**` : '';
    }
    case 'em':
    case 'i': {
      const body = serializeInline(el, undefined, inTable).trim();
      return body ? `*${body}*` : '';
    }
    // Unreachable in practice — `serializeInlineNodes` intercepts a `<code>` before
    // dispatching here, so it can merge a run of them. Kept so this switch stays the
    // single statement of which tags render markup of their own, which is the
    // invariant `MARKUP_INLINE` above is derived from.
    case 'code':
      return inlineCode(el.textContent ?? '', inTable);
    case 'a': {
      const href = (el.getAttribute('href') ?? '').trim();
      // An anchor whose content is an icon or an empty `<span>` serializes to no
      // label, and the href stands in for it — as the visible label it is prose now,
      // not a destination, so it is escaped at this boundary the way the
      // destination-less `img` case escapes its alt. Unescaped it leaks whatever the
      // URL holds into the document: a `|` splits the table row the link sits in, and
      // a `[`/`]` or a backtick corrupts the markup around it.
      const text = serializeInline(el, undefined, inTable).trim() || escapeMarkdownText(href);
      return href ? `[${text}](${linkDestination(href, inTable)})` : text;
    }
    case 'img': {
      // Same destination rules as the `a` case above: written bare, a src holding an
      // unbalanced paren truncates at it and one holding whitespace ends at the space
      // — `linkDestination` wraps the first and percent-encodes the second.
      const src = (el.getAttribute('src') ?? '').trim();
      // Line breaks are collapsed for both branches below: inside `![...]` a newline would
      // leave the closing `]` on a later line, and in the prose branch it would let a
      // marker start a line of its own.
      const alt = (el.getAttribute('alt') ?? '').trim().replace(/\s*[\r\n]+\s*/g, ' ');
      // The alt is display text, not markup, and `![...]` protects nothing inside it: an
      // unescaped alt corrupts the markup around it exactly as an unescaped destination
      // did — a `|` splits the row the image sits in, and a `[`/`]` breaks the image out
      // of its own brackets. Not `atLineStart`: here the `![` always precedes it.
      if (src) return `![${escapeMarkdownText(alt)}](${linkDestination(src, inTable)})`;
      // No usable destination: keep the alt as prose rather than dropping it, the way
      // the `a` case keeps its label. Block markers are escaped too (`atLineStart`),
      // because this chunk can be the first thing in its paragraph and an alt of
      // `- item` would otherwise export as a list.
      // A `-` that turns out to be mid-line is escaped needlessly and renders the
      // same, the trade-off `markdown-escape.ts` already documents.
      return escapeMarkdownText(alt, true);
    }
    case 'br':
      return '\n';
    // Inline wrappers (span, etc.) and block elements that slipped into inline
    // context: recurse so their text survives.
    default:
      return serializeInline(el, undefined, inTable);
  }
}

// A bare link destination is read up to the first unbalanced `)`, so a URL holding
// one (`…/a)b`) is silently truncated by any CommonMark parser, this project's PDF
// renderer included. Whitespace has the same problem. CommonMark provides the
// angle-bracket form for exactly these, so wrap when the destination needs it.
// `inTable` says the destination lands in a GFM cell, where a literal `|` would split
// the row before the link is ever parsed.
function linkDestination(href: string, inTable = false): string {
  // Whitespace cannot survive in a destination in any form: the bare one ends at the
  // first space, and CommonMark forbids a newline even inside the angle brackets — a
  // wrapped newline would also split the link across two lines when the PDF renderer
  // re-splits the document. Percent-encode instead, which is the standard spelling and
  // keeps the link clickable.
  const spaced = href.replace(/\s+/g, '%20');
  // A GFM row is split on its unescaped `|` before any inline parsing, so a pipe here
  // tears the row it sits in. The destination is emitted after the cell-text escaping
  // decision (`escapeCellPipes`), so it has to encode its own — and percent-encoding,
  // not a backslash, because neither reader unescapes a destination on the way back in.
  const piped = inTable ? spaced.replace(/\|/g, '%7C') : spaced;
  // A `\` cannot survive in either form: inside the wrapper it escapes the punctuation
  // after it, so a destination ending in one swallows the closing `>`; bare, a reader
  // resolves `\%` to a literal `%` and the backslash is dropped, leaving a destination
  // that silently differs from the page's. Encode before the form is chosen, so both get it.
  const single = piped.replace(/\\/g, '%5C');
  // A bare destination may hold an angle bracket anywhere but position 0, where CommonMark
  // forbids it outright — that one has no bare spelling and must take the wrapper. Balanced
  // parens decide the rest.
  if (hasBalancedParens(single) && !single.startsWith('<')) return single;
  // The wrapper is now required, and `<`/`>` inside would close it early. Percent-encode
  // both rather than emit a destination that truncates either way.
  return `<${single.replace(/[<>]/g, (ch) => ANGLE_ESCAPES[ch])}>`;
}

// The two characters that cannot appear literally inside an angle destination.
const ANGLE_ESCAPES: Record<string, string> = { '<': '%3C', '>': '%3E' };

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
function inlineCode(text: string, inTable = false): string {
  // A code span occupies one line: a newline in the body would leave the closing
  // fence on a later line, where nothing pairs it (the PDF renderer deliberately
  // refuses to — test/export/pdf.test.ts) and the backticks survive as literal text.
  // Only the line breaks are normalized — a code body is literal text, so collapsing
  // its space runs and tabs the way the prose path does would silently reformat the
  // code the reader saw.
  const flat = text.replace(/[ \t]*[\r\n]+[ \t]*/g, ' ');
  const body = inTable ? escapeCellPipes(flat) : flat;
  const longestRun = longestBacktickRun(body);
  const fence = '`'.repeat(longestRun + 1);
  const pad = longestRun > 0 ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
}

/**
 * Escape the GFM table delimiters in a code body. A row is split on its unescaped
 * `|`, before any inline parsing, so a pipe inside a code span still tears the row
 * unless it is escaped — and the reader consumes backslashes in pairs, so the
 * backslashes already in front of that pipe have to be doubled or the escape lands on
 * the wrong character. A run of `n` backslashes before a pipe therefore becomes `2n`
 * backslashes plus `\|`, which reads back as `n` backslashes and a literal pipe.
 *
 * Backslashes anywhere else are left exactly as the page had them: a code body is
 * literal, and `C:\path` in a cell must stay one backslash in the exported Markdown.
 * `unescapeCellCode` in src/export/markdown-pdf.ts is the inverse and must move with
 * this function.
 */
function escapeCellPipes(body: string): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    if (body[i] === '\\') {
      let end = i;
      while (end < body.length && body[end] === '\\') end++;
      const run = end - i;
      if (body[end] === '|') {
        out += '\\'.repeat(run * 2) + '\\|';
        i = end + 1;
      } else {
        out += '\\'.repeat(run);
        i = end;
      }
      continue;
    }
    out += body[i] === '|' ? '\\|' : body[i];
    i++;
  }
  return out;
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
