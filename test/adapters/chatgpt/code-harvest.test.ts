import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { extract } from '../../../src/adapters/chatgpt';
import { ExtractionError } from '../../../src/core/errors';
import { assistantUnit, page, turn, userUnit } from './markup';

// A CodeMirror 6 code block as measured live (2026-09-29): its pane scrolls internally, and
// only the lines near the viewport exist as `.cm-line` — the rest are a `.cm-gap` spacer
// (36 of 150 lines rendered). happy-dom has no layout engine, so the geometry CodeMirror
// would produce is faked here: 20px lines, a 100px pane, and a re-render on every scroll.
// CodeMirror also draws only what is inside the window, so until the block is scrolled into
// view (measured: 36 of 150 lines below the fold) the fake keeps drawing its first window.
const LINE_H = 20;
const PANE_H = 100;

function gappedBlockDoc(
  source: string[],
  { skip = -1, wrapping = false }: { skip?: number; wrapping?: boolean } = {},
): { doc: Document; pane: HTMLElement; list: HTMLElement } {
  const window = new Window();
  const block =
    '<div data-markdown-copy="code-block"><div data-markdown-copy="exclude"><div>Python</div></div>' +
    `<div class="pane"><div class="cm-content${wrapping ? ' cm-lineWrapping' : ''}" data-language="python"></div></div></div>`;
  window.document.write(page('T', turn('t1', userUnit('u1', 'q'), assistantUnit('a1 a1', block))));
  const doc = window.document as unknown as Document;
  const pane = doc.querySelector('.pane') as HTMLElement;
  const content = doc.querySelector('.cm-content') as HTMLElement;
  const blockEl = doc.querySelector('[data-markdown-copy="code-block"]') as HTMLElement;
  // The message list the block scrolls with; bringing the block into view moves it.
  const list = doc.querySelector('main') as HTMLElement;
  let listTop = 3000;
  Object.defineProperty(list, 'clientHeight', { get: () => 800 });
  Object.defineProperty(list, 'scrollHeight', { get: () => 20000 });
  Object.defineProperty(list, 'scrollTop', { get: () => listTop, set: (v: number) => (listTop = v) });

  let top = 0;
  let inView = false;
  blockEl.scrollIntoView = () => {
    inView = true;
    listTop = 1234;
    render();
  };
  const render = (): void => {
    // Lines within the pane, plus one either side, as CodeMirror's viewport would hold —
    // or, off-screen, only the first window whatever the pane's position.
    const at = inView ? top : 0;
    const first = Math.max(0, Math.floor(at / LINE_H) - 1);
    const last = Math.min(source.length - 1, Math.ceil((at + PANE_H) / LINE_H) + 1);
    content.innerHTML = '';
    if (first > 0) content.appendChild(doc.createElement('div')).className = 'cm-gap';
    for (let i = first; i <= last; i++) {
      if (i === skip) continue; // a renderer that never draws this line
      const line = doc.createElement('div');
      line.className = 'cm-line';
      line.textContent = source[i];
      line.getBoundingClientRect = () => ({ top: -top + i * LINE_H, height: LINE_H }) as DOMRect;
      content.appendChild(line);
    }
    if (last < source.length - 1) content.appendChild(doc.createElement('div')).className = 'cm-gap';
  };
  content.getBoundingClientRect = () => ({ top: -top, height: source.length * LINE_H }) as DOMRect;
  Object.defineProperty(pane, 'clientHeight', { get: () => PANE_H });
  Object.defineProperty(pane, 'scrollHeight', { get: () => source.length * LINE_H });
  Object.defineProperty(pane, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(source.length * LINE_H - PANE_H, v));
      render();
    },
  });
  // Opened part-way down, as a user may have left it.
  pane.scrollTop = 7 * LINE_H;
  return { doc, pane, list };
}

const source = Array.from({ length: 150 }, (_, i) => `print(${i + 1})`);

describe('chatgpt — reading a virtualized CodeMirror block', () => {
  it('recovers every line, in order, by scrolling the pane — and puts every scroll back', async () => {
    const { doc, pane, list } = gappedBlockDoc(source);
    expect(doc.querySelector('.cm-gap')).not.toBeNull(); // the premise: lines are missing

    const convo = await extract(doc, { harvestStepDelayMs: 0 });

    expect(convo.messages[1].content).toBe('```python\n' + source.join('\n') + '\n```');
    expect(pane.scrollTop).toBe(7 * LINE_H);
    expect(list.scrollTop).toBe(3000); // the message walk resumes where it was
  });

  it('fails loud when a line is never rendered at any scroll position', async () => {
    const { doc } = gappedBlockDoc(source, { skip: 42 });
    await expect(extract(doc, { harvestStepDelayMs: 0 })).rejects.toBeInstanceOf(ExtractionError);
  });

  it('fails loud when line wrapping is on — line heights no longer index lines', async () => {
    const { doc } = gappedBlockDoc(source, { wrapping: true });
    await expect(extract(doc, { harvestStepDelayMs: 0 })).rejects.toBeInstanceOf(ExtractionError);
  });
});
