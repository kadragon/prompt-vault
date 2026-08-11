import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { claudeAdapter } from '../../../src/adapters/claude';
import { ExtractionError } from '../../../src/core/errors';

function docFrom(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

/**
 * Same, but served from a real URL so `matchesRecents` can see the route. The missing-table
 * case means different things on and off `/recents`, so the route is part of the fixture.
 */
function docAt(url: string, html: string): Document {
  const window = new Window({ url });
  window.document.write(html);
  return window.document as unknown as Document;
}

// The measured `/recents` shape (2026-08-11): one `main table` carrying `data-cds="Table"`, one
// chat anchor per row. The third row repeats the first conversation's id to pin the dedupe.
const RECENTS = `
  <body>
    <main>
      <table data-cds="Table">
        <tbody>
          <tr class="group/cdsrow"><td><a href="/chat/aaa" aria-label="First recent chat">First recent chat</a></td></tr>
          <tr class="group/cdsrow"><td><a href="/chat/bbb">Second recent chat</a></td></tr>
          <tr class="group/cdsrow"><td><a href="/chat/aaa?from=duplicate" aria-label="First recent chat">First recent chat</a></td></tr>
        </tbody>
      </table>
    </main>
  </body>`;

const RECENTS_URL = 'https://claude.ai/recents';

describe('claudeAdapter.listRecentsConversations', () => {
  it('enumerates measured table rows in order and dedupes stable chat ids', () => {
    const list = claudeAdapter.listRecentsConversations?.(docAt(RECENTS_URL, RECENTS)) ?? [];
    expect(list).toEqual([
      { id: 'aaa', title: 'First recent chat', url: 'https://claude.ai/chat/aaa' },
      { id: 'bbb', title: 'Second recent chat', url: 'https://claude.ai/chat/bbb' },
    ]);
  });

  it('uses the measured table parent as the trigger mount', () => {
    // Measured 2026-08-11: the table's parent is a plain container whose only child is the
    // table — the same mount shape the project trigger already uses.
    const doc = docAt(RECENTS_URL, RECENTS);
    expect(claudeAdapter.recentsToolbarMount?.(doc)?.tagName).toBe('MAIN');
  });

  it('fails loud when a measured row has no chat anchor', () => {
    const doc = docAt(
      RECENTS_URL,
      '<body><main><table data-cds="Table"><tbody><tr class="group/cdsrow"><td>broken</td></tr></tbody></table></main></body>',
    );
    expect(() => claudeAdapter.listRecentsConversations?.(doc)).toThrow(ExtractionError);
  });

  it('fails loud when a measured row carries two chat anchors', () => {
    // 26/26 rows held exactly one anchor. Two means the row's identity is ambiguous, and
    // silently picking one would export the wrong conversation for that position.
    const doc = docAt(
      RECENTS_URL,
      '<body><main><table data-cds="Table"><tbody><tr class="group/cdsrow"><td>' +
        '<a href="/chat/aaa" aria-label="First">First</a><a href="/chat/bbb" aria-label="Second">Second</a>' +
        '</td></tr></tbody></table></main></body>',
    );
    expect(() => claudeAdapter.listRecentsConversations?.(doc)).toThrow(ExtractionError);
  });

  it('fails loud when the recents route renders no table at all', () => {
    // Downstream, `[]` is the bulk panel's "no conversations" state — indistinguishable from a
    // whole history reported as empty (AGENTS.md #4). On the `/recents` ROUTE a missing table is
    // markup drift, so it must be loud.
    const doc = docAt(RECENTS_URL, '<body><main>still hydrating</main></body>');
    expect(() => claudeAdapter.listRecentsConversations?.(doc)).toThrow(ExtractionError);
  });

  it('still returns an empty list when the same markup is not on the recents route', () => {
    // The route is what distinguishes drift from absence — off `/recents` no claim is being made
    // about the history, so an empty list stays the honest answer.
    const doc = docAt('https://claude.ai/chat/aaa', '<body><main>not ready</main></body>');
    expect(claudeAdapter.listRecentsConversations?.(doc)).toEqual([]);
  });

  it('returns an empty list for a rootless fixture with no table and no route', () => {
    expect(claudeAdapter.listRecentsConversations?.(docFrom('<body><main>not ready</main></body>'))).toEqual([]);
  });
});

const ROW_HEIGHT = 20;

/**
 * A `/recents` page whose list keeps growing as it is scrolled — the shape the measured account
 * (26 conversations, fully rendered) never showed, and precisely the case `onIncomplete` exists
 * for, since "does not page" is only established at that size.
 */
function makeRecentsPage({ total, runaway = false }: { total: number; runaway?: boolean }): ParentNode {
  let top = 0;
  let count = total;

  const anchorFor = (id: number): Element =>
    ({
      getAttribute: (name: string): string | null => {
        if (name === 'href') return `/chat/${id}`;
        if (name === 'aria-label') return `Chat ${id}`;
        return null;
      },
      textContent: `Chat ${id}`,
    }) as unknown as Element;

  const rowFor = (id: number): Element =>
    ({
      querySelectorAll: (selector: string): Element[] =>
        selector === 'a[href^="/chat/"]' ? [anchorFor(id)] : [],
    }) as unknown as Element;

  const visibleIds = (): number[] => {
    const first = Math.min(Math.floor(top / ROW_HEIGHT), Math.max(0, count - 3));
    return Array.from({ length: Math.min(3, count - first) }, (_, offset) => first + offset);
  };

  const table = {
    clientHeight: ROW_HEIGHT * 3,
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
    querySelector: (selector: string): Element | null => table.querySelectorAll(selector)[0] ?? null,
    querySelectorAll: (selector: string): Element[] => {
      if (selector === 'tbody > tr') return visibleIds().map(rowFor);
      if (selector === 'a[href^="/chat/"]') return visibleIds().map(anchorFor);
      return [];
    },
  };

  return {
    querySelectorAll: (selector: string): unknown[] => (selector === 'main table' ? [table] : []),
  } as unknown as ParentNode;
}

describe('claudeAdapter.loadMoreRecentsConversations', () => {
  it('steps through the list port and returns every deduped chat id', async () => {
    const progress: number[] = [];
    const list = await claudeAdapter.loadMoreRecentsConversations?.(makeRecentsPage({ total: 9 }), {
      stepDelayMs: 0,
      stableRounds: 2,
      maxSteps: 30,
      onProgress: (count) => progress.push(count),
    });
    expect(list?.map((conversation) => conversation.id)).toEqual(Array.from({ length: 9 }, (_, i) => String(i)));
    expect(progress.at(-1)).toBe(9);
  });

  it('returns the rendered list without inventing paging when the port does not scroll', async () => {
    // The measured shape: everything is already in the DOM, so there is nothing to walk.
    const list = await claudeAdapter.loadMoreRecentsConversations?.(docAt(RECENTS_URL, RECENTS), {
      stepDelayMs: 0,
    });
    expect(list?.map((conversation) => conversation.id)).toEqual(['aaa', 'bbb']);
  });

  it('reports the step cap as incomplete while still returning what it loaded', async () => {
    const incomplete: boolean[] = [];
    const list = await claudeAdapter.loadMoreRecentsConversations?.(makeRecentsPage({ total: 4, runaway: true }), {
      stepDelayMs: 0,
      stableRounds: 2,
      maxSteps: 4,
      onIncomplete: () => incomplete.push(true),
    });
    // `onIncomplete` is the shared partial-list signal (src/adapters/types.ts): the panel must be
    // able to say the history may be short rather than present it as complete (AGENTS.md #4).
    // Throwing here would discard every id the walk did find.
    expect(incomplete).toEqual([true]);
    expect(list?.length).toBeGreaterThan(0);
  });

  it('fails loud when the recents route renders no table at all', async () => {
    const doc = docAt(RECENTS_URL, '<body><main>still hydrating</main></body>');
    await expect(claudeAdapter.loadMoreRecentsConversations?.(doc, { stepDelayMs: 0 })).rejects.toThrow(
      ExtractionError,
    );
  });
});
