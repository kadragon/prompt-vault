import { describe, it, expect } from 'vitest';
import { collectVirtualizedTurns } from '../../../src/adapters/chatgpt';
import { ExtractionError } from '../../../src/core/errors';

// Model ChatGPT's *windowing* virtualization: only the turn nodes whose fixed-height
// band intersects the current viewport `[scrollTop, scrollTop + clientHeight)` exist in
// the DOM at all (the rest are removed, not merely emptied). A turn reports content only
// while it is on screen — unless it is a `skeleton` (hollow until fully centered) or
// `neverFills` (empty at every position, i.e. genuinely unreadable).
interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  skeleton?: boolean;
  neverFills?: boolean;
}

const TURN_H = 100;

function makeWindowedDoc({ turns, clientHeight = 250 }: { turns: Turn[]; clientHeight?: number }): Document {
  const container = { scrollTop: 0, clientHeight, scrollHeight: turns.length * TURN_H };

  const intersects = (i: number): boolean => {
    const top = i * TURN_H;
    return top < container.scrollTop + container.clientHeight && top + TURN_H > container.scrollTop;
  };
  const fullyInside = (i: number): boolean => {
    const top = i * TURN_H;
    return top >= container.scrollTop && top + TURN_H <= container.scrollTop + container.clientHeight;
  };

  const makeNode = (t: Turn, i: number) => {
    const text = (): string => {
      if (t.neverFills) return '';
      if (t.skeleton && !fullyInside(i)) return ''; // hollow until centered
      return t.content;
    };
    return {
      getAttribute(name: string): string | null {
        if (name === 'data-message-author-role') return t.role;
        if (name === 'data-message-id') return t.id;
        return null;
      },
      querySelector(sel: string): { textContent: string } | null {
        // user → pre-wrap block; assistant → no .markdown, so content falls back to textContent
        return t.role === 'user' && sel === '.whitespace-pre-wrap' ? { textContent: text() } : null;
      },
      querySelectorAll(): never[] {
        return []; // no attachment tiles in these turns
      },
      get textContent(): string {
        return text();
      },
    };
  };

  return {
    querySelector: (sel: string) => (sel === '[data-scroll-root]' ? container : null),
    querySelectorAll: (sel: string) =>
      sel === '[data-message-author-role]' ? turns.map(makeNode).filter((_, i) => intersects(i)) : [],
  } as unknown as Document;
}

const fast = { stepDelayMs: 0 };

describe('collectVirtualizedTurns — windowed message list', () => {
  it('accumulates every turn across the scroll even though only a few exist in the DOM at once', async () => {
    const turns: Turn[] = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `content ${i}`,
    }));
    const doc = makeWindowedDoc({ turns });

    const messages = await collectVirtualizedTurns(doc, fast);

    // The whole conversation is recovered, in order — not just the ~3-turn window.
    expect(messages).toHaveLength(20);
    expect(messages.map((m) => m.content)).toEqual(turns.map((t) => t.content));
    expect(messages.map((m) => m.id)).toEqual(turns.map((t) => t.id));
    expect(messages.map((m) => m.role)).toEqual(turns.map((t) => t.role));
  });

  it('upgrades a turn captured as a skeleton once it hydrates on a later sighting', async () => {
    // Index 3 (band 300–400) first intersects the window while only partially visible —
    // captured as an empty skeleton — then fully centers a step later and hydrates.
    const turns: Turn[] = [
      { id: 'a', role: 'user', content: 'first' },
      { id: 'b', role: 'user', content: 'second' },
      { id: 'c', role: 'user', content: 'third' },
      { id: 'd', role: 'user', content: 'hydrated late', skeleton: true },
      { id: 'e', role: 'user', content: 'fifth' },
      { id: 'f', role: 'user', content: 'sixth' },
    ];
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);

    expect(messages.map((m) => m.content)).toEqual(['first', 'second', 'third', 'hydrated late', 'fifth', 'sixth']);
  });

  it('fails loud when a turn never yields content at any scroll position', async () => {
    const turns: Turn[] = [
      { id: 'a', role: 'user', content: 'ok' },
      { id: 'b', role: 'user', content: '(image only)', neverFills: true },
      { id: 'c', role: 'user', content: 'ok too' },
    ];
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toBeInstanceOf(ExtractionError);
  });
});
