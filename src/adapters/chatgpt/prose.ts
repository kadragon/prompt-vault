// Turns one ChatGPT rendered-Markdown root (a reply, or a prompt that holds a fenced block)
// into Markdown. The app-shell DOM renders several
// blocks in shapes the provider-agnostic `htmlToMarkdown` cannot read — code as a
// CodeMirror editor with no `<pre>`, inline code as a `<span>` — so this module rewrites a
// CLONE of the root into ordinary HTML first, keeping all ChatGPT DOM knowledge in the
// adapter (AGENTS.md #3). The live root is only read, and scrolled when a code block has
// to be harvested; it is never mutated.

import { delay } from '../../core/sidebar';
import { ExtractionError } from '../../core/errors';
import { htmlToMarkdown } from '../../core/html-to-markdown';
import { selectors } from './selectors';

/** Pause after each pane scroll, so CodeMirror can re-render the lines now in view. */
const HARVEST_STEP_DELAY_MS = 100;
/** Fraction of the pane height moved per harvest step — overlapping, so no line is skipped. */
const HARVEST_STEP_FRACTION = 0.8;
/** Anti-runaway backstop for one block's harvest; far above any real block. */
const HARVEST_MAX_STEPS = 2000;

export interface ProseOptions {
  /** Override the harvest step pause (tests). */
  harvestStepDelayMs?: number;
}

interface CodeBlockSource {
  language: string;
  text: string;
}

/** Markdown for one rendered-Markdown root (`selectors.assistantMarkdown` or `selectors.userMarkdown`). */
export async function proseToMarkdown(root: Element, options: ProseOptions = {}): Promise<string> {
  // Read every code block off the LIVE root first: a virtualized CodeMirror block has to be
  // scrolled to be read, which a detached clone cannot do.
  const sources: CodeBlockSource[] = [];
  for (const block of Array.from(root.querySelectorAll(selectors.codeBlock))) {
    sources.push(await readCodeBlock(block, options));
  }

  const clone = root.cloneNode(true) as Element;
  const doc = clone.ownerDocument;
  Array.from(clone.querySelectorAll(selectors.codeBlock)).forEach((block, i) => {
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    if (sources[i].language) code.setAttribute('class', `language-${sources[i].language}`);
    code.textContent = sources[i].text;
    pre.appendChild(code);
    block.replaceWith(pre);
  });
  for (const rich of Array.from(clone.querySelectorAll(selectors.richBlock))) {
    const content = rich.querySelector(selectors.richBlockContent);
    if (content) rich.replaceWith(content);
    else rich.remove();
  }
  clone.querySelectorAll(`${selectors.copyExclude}, ${selectors.citationFavicon}`).forEach((n) => n.remove());
  for (const span of Array.from(clone.querySelectorAll(selectors.inlineCode))) {
    const code = doc.createElement('code');
    code.textContent = span.textContent ?? '';
    span.replaceWith(code);
  }
  return htmlToMarkdown(clone);
}

/**
 * Source text and language of one code block, whichever of its three renderings is live.
 * Fails loud (AGENTS.md #4) rather than return a block with lines missing.
 */
async function readCodeBlock(block: Element, options: ProseOptions): Promise<CodeBlockSource> {
  const content = block.querySelector(selectors.codeMirrorContent);
  // The header label ("Python") is the only language source for the static renderings;
  // `htmlToMarkdown` lowercases it and drops anything that is not a language token.
  const label = headerLabel(block);
  if (content) {
    const language = content.getAttribute(selectors.codeMirrorLanguageAttr) ?? label;
    const text = content.querySelector(selectors.codeMirrorGap)
      ? await harvestCodeMirror(block, content, options)
      : Array.from(content.querySelectorAll(selectors.codeMirrorLine), (line) => line.textContent ?? '').join('\n');
    return { language, text };
  }
  // Static renderings hold the whole source with real newlines: `<pre><code>` or a bare
  // `code.whitespace-pre!`.
  const code = block.querySelector('pre') ?? block.querySelector('code');
  return { language: label, text: code?.textContent ?? '' };
}

/** The code-block header's language label, without any button or icon text. */
function headerLabel(block: Element): string {
  const header = block.querySelector(selectors.copyExclude);
  if (!header) return '';
  const clone = header.cloneNode(true) as Element;
  clone.querySelectorAll('button, svg').forEach((n) => n.remove());
  return (clone.textContent ?? '').trim();
}

/**
 * Read a CodeMirror block whose off-screen lines are replaced by `.cm-gap` spacers, by
 * scrolling its pane top to bottom and indexing each rendered line by its offset. CodeMirror
 * draws only lines inside the WINDOW as well as the pane — measured live 2026-09-29: 36 of
 * 150 lines with the block below the fold, all 150 once it was in view — so the block is
 * first scrolled into view. Line height is uniform only with wrapping off, so a wrapping
 * block — or one whose layout reads as zero (no rendering engine) — cannot be indexed and
 * fails loud. Every scroll position touched (the pane and its scrolling ancestors, which
 * include the message list mid-walk) is restored afterwards.
 */
async function harvestCodeMirror(block: Element, content: Element, options: ProseOptions): Promise<string> {
  const { harvestStepDelayMs = HARVEST_STEP_DELAY_MS } = options;
  const incomplete = (): ExtractionError =>
    new ExtractionError(
      'A long code block could not be read in full. Scroll it into view and try again, or ' +
        'report this if it persists.',
    );

  const pane = scrollPaneOf(block, content);
  const firstLine = content.querySelector(selectors.codeMirrorLine);
  const lineHeight = firstLine ? firstLine.getBoundingClientRect().height : 0;
  if (!pane || lineHeight <= 0 || content.classList.contains(selectors.codeMirrorWrappingClass)) {
    throw incomplete();
  }
  const view = content.ownerDocument.defaultView;
  const style = view?.getComputedStyle(content);
  const padTop = parseFloat(style?.paddingTop ?? '0') || 0;
  const padBottom = parseFloat(style?.paddingBottom ?? '0') || 0;
  const total = Math.round((content.getBoundingClientRect().height - padTop - padBottom) / lineHeight);

  const lines = new Map<number, string>();
  const grab = (): void => {
    const top = content.getBoundingClientRect().top + padTop;
    for (const line of Array.from(content.querySelectorAll(selectors.codeMirrorLine))) {
      lines.set(Math.round((line.getBoundingClientRect().top - top) / lineHeight), line.textContent ?? '');
    }
  };

  const restore = [pane, ...scrollingAncestors(block)].map((el) => [el, el.scrollTop] as const);
  try {
    block.scrollIntoView?.({ block: 'nearest' });
    pane.scrollTop = 0;
    await delay(harvestStepDelayMs);
    const step = Math.max(1, Math.floor(pane.clientHeight * HARVEST_STEP_FRACTION));
    for (let i = 0; i < HARVEST_MAX_STEPS; i++) {
      grab();
      if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1) break;
      const before = pane.scrollTop;
      pane.scrollTop = before + step;
      if (pane.scrollTop === before) break; // clamped: nothing further to scroll into
      await delay(harvestStepDelayMs);
    }
    grab();
  } finally {
    for (const [el, top] of restore) el.scrollTop = top;
  }

  // `total` came from the content height, which counts `.cm-gap` spacers at CodeMirror's
  // ESTIMATED heights. A line measured past it proves the estimate ran short: extend to it
  // rather than drop the tail. An estimate that ran long leaves an index unfilled and fails
  // loud below.
  const last = Math.max(total, ...Array.from(lines.keys(), (i) => i + 1));
  const out: string[] = [];
  for (let i = 0; i < last; i++) {
    const line = lines.get(i);
    if (line === undefined) throw incomplete();
    out.push(line);
  }
  return out.join('\n');
}

/** Every ancestor of `el` that currently scrolls, nearest first. */
function scrollingAncestors(el: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (a.scrollHeight > a.clientHeight + 1) out.push(a);
  }
  return out;
}

/** The element inside `block` that actually scrolls `content`, or null. */
function scrollPaneOf(block: Element, content: Element): HTMLElement | null {
  for (let el: Element | null = content; el && el !== block.parentElement; el = el.parentElement) {
    const h = el as HTMLElement;
    if (h.scrollHeight > h.clientHeight + 1) return h;
  }
  return null;
}
