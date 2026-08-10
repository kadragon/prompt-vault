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
 * Same, but served from a real URL so `matchesProject` can see the route. The missing-table
 * case means different things on and off a project home, so the route is part of the fixture.
 */
function docAt(url: string, html: string): Document {
  const window = new Window({ url });
  window.document.write(html);
  return window.document as unknown as Document;
}

const PROJECT = `
  <body>
    <main>
      <table data-cds="Table">
        <tbody>
          <tr class="group/cdsrow"><td><a href="/chat/aaa" aria-label="First project chat">First project chat</a></td></tr>
          <tr class="group/cdsrow"><td><a href="/chat/bbb">Second project chat</a></td></tr>
          <tr class="group/cdsrow"><td><a href="/chat/aaa?from=duplicate" aria-label="First project chat">First project chat</a></td></tr>
        </tbody>
      </table>
    </main>
  </body>`;

describe('claudeAdapter.listProjectConversations', () => {
  it('enumerates measured table rows in order and dedupes stable chat ids', () => {
    const list = claudeAdapter.listProjectConversations?.(docFrom(PROJECT)) ?? [];
    expect(list).toEqual([
      { id: 'aaa', title: 'First project chat', url: 'https://claude.ai/chat/aaa' },
      { id: 'bbb', title: 'Second project chat', url: 'https://claude.ai/chat/bbb' },
    ]);
  });

  it('uses the measured table parent as the project trigger mount', () => {
    const doc = docFrom(PROJECT);
    expect(claudeAdapter.projectToolbarMount?.(doc)?.tagName).toBe('MAIN');
  });

  it('returns an empty list when the project table is absent', () => {
    expect(claudeAdapter.listProjectConversations?.(docFrom('<body><main>not ready</main></body>'))).toEqual([]);
  });

  it('fails loud when a measured project row has no chat anchor', () => {
    const doc = docFrom(
      '<body><main><table data-cds="Table"><tbody><tr class="group/cdsrow"><td>broken</td></tr></tbody></table></main></body>',
    );
    expect(() => claudeAdapter.listProjectConversations?.(doc)).toThrow(ExtractionError);
  });

  it('picks the conversation table rather than a knowledge table that precedes it', () => {
    // The chat anchors, not document order, identify the list — a non-chat table rendered
    // first would otherwise be walked and fail every row's exactly-one-anchor check.
    const doc = docFrom(
      '<body><main>' +
        '<table data-cds="Table"><tbody><tr><td>project-notes.pdf</td></tr></tbody></table>' +
        '<table data-cds="Table"><tbody><tr class="group/cdsrow"><td><a href="/chat/aaa" aria-label="First">First</a></td></tr></tbody></table>' +
        '</main></body>',
    );
    expect(claudeAdapter.listProjectConversations?.(doc)).toEqual([
      { id: 'aaa', title: 'First', url: 'https://claude.ai/chat/aaa' },
    ]);
  });

  it('fails loud when a project chat anchor has no title', () => {
    const doc = docFrom(
      '<body><main><table data-cds="Table"><tbody><tr><td><a href="/chat/aaa"></a></td></tr></tbody></table></main></body>',
    );
    expect(() => claudeAdapter.listProjectConversations?.(doc)).toThrow(ExtractionError);
  });

  it('fails loud when a project route renders no table at all', () => {
    // The silent-failure case this guard exists for: downstream, `[]` is rendered as the bulk
    // panel's "no conversations" state, which is indistinguishable from a genuinely empty
    // project. On a project ROUTE a missing table is markup drift, so it must be loud
    // (AGENTS.md #4) rather than reporting a full project as empty.
    const doc = docAt(
      'https://claude.ai/cowork/project/019fa713-98b7-7050-8802-bc412d1c4800',
      '<body><main>still hydrating</main></body>',
    );
    expect(() => claudeAdapter.listProjectConversations?.(doc)).toThrow(ExtractionError);
  });

  it('still returns an empty list when the same markup is not on a project route', () => {
    // The route is what distinguishes drift from absence — off a project home there is no
    // claim being made about a project, so an empty list stays the honest answer.
    const doc = docAt('https://claude.ai/chat/aaa', '<body><main>not ready</main></body>');
    expect(claudeAdapter.listProjectConversations?.(doc)).toEqual([]);
  });
});
