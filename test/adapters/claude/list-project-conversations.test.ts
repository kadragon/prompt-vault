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

  // Every project-home fixture below carries the app shell's `aside`, because the whole document
  // is what the adapter is handed at runtime (`mount.ts` passes `doc`). The aside holds recent-chat
  // anchors matching the SAME `a[href^="/chat/"]` string the project list uses — measured at 20 on
  // every route — so a probe written against `<main>` alone silently passes here and fails for
  // every real user who has any chat history. Do not drop the aside from these fixtures.
  const SIDEBAR =
    '<aside>' +
    '<a href="/chat/sidebar-1" aria-label="Unrelated recent">Unrelated recent</a>' +
    '<a href="/chat/sidebar-2" aria-label="Another recent">Another recent</a>' +
    '</aside>';

  it('renders an empty project as an empty list instead of a markup-drift error', () => {
    // Measured 2026-08-11: an empty project renders NO `main table` whatsoever, so it landed on
    // the drift branch above and reported Claude's markup as broken to a user who had simply not
    // started a chat in the project yet. The project-home shell marker is what says the page did
    // render — present on the empty and both populated projects measured, absent on `/chat/<id>`.
    const doc = docAt(
      'https://claude.ai/cowork/project/019fee6c-e6ad-77e1-9e39-9b718ee6e400',
      `<body>${SIDEBAR}<main><div data-testid="project-doc-upload"></div></main></body>`,
    );
    expect(claudeAdapter.listProjectConversations?.(doc)).toEqual([]);
  });

  it('renders an empty project that HAS knowledge documents as an empty list', () => {
    // The shape the 2026-08-11 measurement could not see: the project measured empty held no
    // documents, so it rendered no table at all. A project with documents and no conversations
    // plausibly renders a document table, which `resolveProjectTable`'s first-table fallback hands
    // back as the list — and the row contract then throws "a table row did not contain exactly one
    // conversation link", which is the very error this fix exists to remove. Keying the empty
    // decision on the absence of conversation LINKS rather than of a table covers both shapes.
    const doc = docAt(
      'https://claude.ai/cowork/project/019fee6c-e6ad-77e1-9e39-9b718ee6e400',
      `<body>${SIDEBAR}<main><div data-testid="project-doc-upload"></div>` +
        '<table data-cds="Table"><tbody><tr><td>project-notes.pdf</td></tr></tbody></table>' +
        '</main></body>',
    );
    expect(claudeAdapter.listProjectConversations?.(doc)).toEqual([]);
  });

  it('fails loud when the project home rendered but its list drifted out of a table', () => {
    // The half of the old first-table fallback worth keeping. A project WITH conversations still
    // renders links to them whatever element wraps them, so a stranded chat anchor beside a
    // rendered project home is drift, not an empty project — and drift must never read as `[]`
    // (AGENTS.md #4). Without this the whole markup-change case became silently empty.
    //
    // Paired with the empty-project case above, this is what pins the probe's SCOPE: the two
    // fixtures differ only in whether the stray anchor is inside `main`, so a document-wide probe
    // turns the empty case red and a probe that misses `main` entirely turns this one red.
    const doc = docAt(
      'https://claude.ai/cowork/project/019f6339-2458-73b9-a484-25f46bb23a16',
      `<body>${SIDEBAR}<main><div data-testid="project-doc-upload"></div>` +
        '<ul><li><a href="/chat/aaa" aria-label="First">First</a></li></ul>' +
        '</main></body>',
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
