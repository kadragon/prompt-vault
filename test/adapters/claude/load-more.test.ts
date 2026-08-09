import { describe, it, expect } from 'vitest';
import { claudeAdapter } from '../../../src/adapters/claude';
import { ExtractionError } from '../../../src/core/errors';
import { Window } from 'happy-dom';

const ROW_HEIGHT = 20;

function makeSidebar({ total, runaway = false, scrollable = true }: { total: number; runaway?: boolean; scrollable?: boolean }): {
  root: ParentNode;
} {
  let top = 0;
  let count = total;
  const sidebar = {
    clientHeight: scrollable ? ROW_HEIGHT * 3 : ROW_HEIGHT * Math.max(1, total),
    get scrollHeight(): number {
      return count * ROW_HEIGHT;
    },
    get scrollTop(): number {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.min(value, count * ROW_HEIGHT);
      if (runaway) count++;
    },
    parentElement: null,
    ownerDocument: { defaultView: null },
    querySelectorAll: (selector: string): Element[] => {
      if (selector !== 'a[href^="/chat/"]') return [];
      const first = Math.min(Math.floor(top / ROW_HEIGHT), Math.max(0, count - 3));
      return Array.from({ length: Math.min(3, count - first) }, (_, offset) => {
        const id = first + offset;
        return {
          getAttribute: (name: string): string | null => {
            if (name === 'href') return `/chat/${id}`;
            if (name === 'aria-label') return `Chat ${id}`;
            return null;
          },
          textContent: `Chat ${id}`,
        } as unknown as Element;
      });
    },
  };
  const root = {
    querySelector: (selector: string): unknown => (selector === 'aside[aria-label="사이드바"]' ? sidebar : null),
  } as unknown as ParentNode;
  return { root };
}

describe('claudeAdapter.loadMoreConversations', () => {
  it('uses the nested recent-chat port rather than the measured aside shell', async () => {
    const window = new Window();
    window.document.write(
      '<body><aside aria-label="사이드바"><div id="recent" style="overflow-y:auto">' +
        '<a href="/chat/aaa" aria-label="First">First</a><a href="/chat/bbb" aria-label="Second">Second</a>' +
        '</div></aside></body>',
    );
    const port = window.document.getElementById('recent')!;
    let top = 0;
    Object.defineProperties(port, {
      clientHeight: { configurable: true, value: 20 },
      scrollHeight: { configurable: true, value: 40 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = Math.min(value, 20);
        },
      },
    });

    await claudeAdapter.loadMoreConversations?.(window.document as unknown as Document, {
      stepDelayMs: 0,
      stableRounds: 2,
      maxSteps: 10,
    });
    expect(top).toBe(20);
  });

  it('steps through the measured scroll port and returns every deduped chat id', async () => {
    const progress: number[] = [];
    const { root } = makeSidebar({ total: 9 });
    const list = await claudeAdapter.loadMoreConversations?.(root, {
      stepDelayMs: 0,
      stableRounds: 2,
      maxSteps: 30,
      onProgress: (count) => progress.push(count),
    });
    expect(list?.map((conversation) => conversation.id)).toEqual(Array.from({ length: 9 }, (_, i) => String(i)));
    expect(progress).toEqual([3, 5, 8, 9]);
  });

  it('returns the rendered list without inventing paging when the port is not scrollable', async () => {
    const { root } = makeSidebar({ total: 2, scrollable: false });
    const list = await claudeAdapter.loadMoreConversations?.(root, { stepDelayMs: 0 });
    expect(list?.map((conversation) => conversation.id)).toEqual(['0', '1']);
  });

  it('returns an empty list when the sidebar is absent', async () => {
    const root = { querySelector: () => null } as unknown as ParentNode;
    await expect(claudeAdapter.loadMoreConversations?.(root, { stepDelayMs: 0 })).resolves.toEqual([]);
  });

  it('fails loud at the bounded step cap instead of returning a partial runaway list', async () => {
    const incomplete: boolean[] = [];
    const { root } = makeSidebar({ total: 4, runaway: true });
    await expect(
      claudeAdapter.loadMoreConversations?.(root, {
        stepDelayMs: 0,
        stableRounds: 2,
        maxSteps: 4,
        onIncomplete: () => incomplete.push(true),
      }),
    ).rejects.toBeInstanceOf(ExtractionError);
    expect(incomplete).toEqual([true]);
  });
});
