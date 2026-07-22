import { describe, it, expect } from 'vitest';
import { collectVirtualizedTurns } from '../../../src/adapters/chatgpt';
import { ExtractionError } from '../../../src/core/errors';

// Model ChatGPT's *windowing* virtualization: only the turn nodes whose fixed-height
// band intersects the current viewport `[scrollTop, scrollTop + clientHeight)` exist in
// the DOM at all (the rest are removed, not merely emptied). A turn reports content only
// while it is on screen — unless it is a `skeleton` (hollow until fully centered),
// `neverFills` (empty at every position, i.e. genuinely unreadable), or has `uiText`
// (a stray non-content string, e.g. "Copy", exposed via textContent before its real
// content element renders — captured unreliably, must be upgraded once hydrated).
interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  skeleton?: boolean;
  neverFills?: boolean;
  uiText?: string;
  idless?: boolean;
}

const TURN_H = 100;

function makeWindowedDoc({
  turns,
  clientHeight = 250,
  stuckScroll = false,
}: {
  turns: Turn[];
  clientHeight?: number;
  stuckScroll?: boolean;
}): Document {
  let top = 0;
  const container = {
    clientHeight,
    scrollHeight: turns.length * TURN_H,
    get scrollTop(): number {
      return top;
    },
    set scrollTop(v: number) {
      if (!stuckScroll) top = v; // a stuck container ignores scroll writes (never advances)
    },
  };

  const intersects = (i: number): boolean => {
    const t = i * TURN_H;
    return t < container.scrollTop + container.clientHeight && t + TURN_H > container.scrollTop;
  };
  const fullyInside = (i: number): boolean => {
    const t = i * TURN_H;
    return t >= container.scrollTop && t + TURN_H <= container.scrollTop + container.clientHeight;
  };

  const makeNode = (t: Turn, i: number) => {
    // The real content element (pre-wrap) is present only once the turn is hydrated:
    // for skeleton/uiText turns that means fully centered; otherwise whenever rendered.
    const hydrated = (): boolean => (t.skeleton || t.uiText !== undefined ? fullyInside(i) : true);
    const text = (): string => {
      if (t.neverFills) return '';
      if (!hydrated()) return t.uiText ?? ''; // skeleton → empty; uiText → stray UI text
      return t.content;
    };
    return {
      getAttribute(name: string): string | null {
        if (name === 'data-message-author-role') return t.role;
        if (name === 'data-message-id') return t.idless ? null : t.id;
        return null;
      },
      querySelector(sel: string): { textContent: string } | null {
        // user → pre-wrap block (only when hydrated); assistant → no .markdown, so content
        // falls back to textContent. A non-hydrated turn has no proper element.
        return t.role === 'user' && sel === '.whitespace-pre-wrap' && hydrated() ? { textContent: text() } : null;
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

  it('replaces stray UI text captured before hydration with the real content (reliable upgrade)', async () => {
    // Index 3 is first sighted while partially visible: no content element yet, only stray
    // UI text ("Copy") via textContent — captured unreliably. Once centered its real content
    // element renders and must overwrite the UI text.
    const turns: Turn[] = [
      { id: 'a', role: 'user', content: 'first' },
      { id: 'b', role: 'user', content: 'second' },
      { id: 'c', role: 'user', content: 'third' },
      { id: 'd', role: 'user', content: 'the real message', uiText: 'Copy' },
      { id: 'e', role: 'user', content: 'fifth' },
      { id: 'f', role: 'user', content: 'sixth' },
    ];
    const messages = await collectVirtualizedTurns(makeWindowedDoc({ turns }), fast);

    expect(messages.map((m) => m.content)).toEqual(['first', 'second', 'third', 'the real message', 'fifth', 'sixth']);
  });

  it('fails loud instead of truncating when the walk cannot reach the bottom', async () => {
    // A container that ignores scroll writes never advances, so the walk can never reach the
    // bottom; it must throw rather than return only the top window as a complete conversation.
    const turns: Turn[] = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, role: 'user' as const, content: `c${i}` }));
    await expect(
      collectVirtualizedTurns(makeWindowedDoc({ turns, stuckScroll: true }), fast),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('fails loud when a recognized turn has no message id', async () => {
    const turns: Turn[] = [
      { id: 'a', role: 'user', content: 'has id' },
      { id: 'x', role: 'assistant', content: 'no id here', idless: true },
      { id: 'c', role: 'user', content: 'also has id' },
    ];
    await expect(collectVirtualizedTurns(makeWindowedDoc({ turns }), fast)).rejects.toBeInstanceOf(ExtractionError);
  });

  it('falls back to a one-shot read (no multi-minute hang) when the container has zero height', async () => {
    // A hidden/background tab reports clientHeight 0; the walk would crawl 1px per step up to
    // the absolute cap. Instead it must take the snapshot path. Here the nodes are materialized
    // (not windowed), so the snapshot recovers them directly.
    const nodes = [
      { role: 'user', id: 'u1', content: 'hi' },
      { role: 'assistant', id: 'a1', content: 'hello' },
    ].map((t) => ({
      getAttribute: (n: string) =>
        n === 'data-message-author-role' ? t.role : n === 'data-message-id' ? t.id : null,
      querySelector: (sel: string) => (t.role === 'user' && sel === '.whitespace-pre-wrap' ? { textContent: t.content } : null),
      querySelectorAll: () => [],
      get textContent() {
        return t.content;
      },
    }));
    const doc = {
      querySelector: (sel: string) => (sel === '[data-scroll-root]' ? { scrollTop: 0, clientHeight: 0, scrollHeight: 5000 } : null),
      querySelectorAll: (sel: string) => (sel === '[data-message-author-role]' ? nodes : []),
    } as unknown as Document;

    const messages = await collectVirtualizedTurns(doc, fast);
    expect(messages.map((m) => m.content)).toEqual(['hi', 'hello']);
  });
});
