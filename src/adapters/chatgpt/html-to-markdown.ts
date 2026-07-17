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
      return serializeList(el, tag === 'ol', listDepth);
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

function serializeList(list: Element, ordered: boolean, depth: number): string {
  const items = Array.from(list.children).filter((c) => c.tagName.toLowerCase() === 'li');
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  items.forEach((li, i) => {
    const marker = ordered ? `${i + 1}. ` : '- ';
    // Split each <li> into its own inline text and any nested lists.
    const nestedLists = Array.from(li.children).filter((c) =>
      ['ul', 'ol'].includes(c.tagName.toLowerCase()),
    );
    const inline = serializeInline(li, new Set(nestedLists)).trim();
    lines.push(indent + marker + inline);
    for (const nested of nestedLists) {
      lines.push(serializeList(nested, nested.tagName.toLowerCase() === 'ol', depth + 1));
    }
  });
  return lines.join('\n');
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
  let out = '';
  for (const node of Array.from(el.childNodes)) {
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
  return el.querySelector('p, ul, ol, pre, blockquote, hr, h1, h2, h3, h4, h5, h6') !== null;
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
