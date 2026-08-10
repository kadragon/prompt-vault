import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { claudeAdapter } from '../../../src/adapters/claude';
import { ExtractionError } from '../../../src/core/errors';

function docFrom(html: string): Document {
  const window = new Window();
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

  it('does not claim an assistant markdown table as the project conversation list', () => {
    // A `/chat/<id>` answer can render a table inside `<main>`. It carries no `data-cds`
    // (measured 2026-08-10), and without that attribute in the selector the anchor-less
    // fallback in `resolveProjectTable` would hand it to every project consumer.
    const doc = docFrom(
      '<body><main><div class="standard-markdown"><table><tbody>' +
        '<tr><td>row one</td><td>2</td></tr>' +
        '<tr><td>row two</td><td>3</td></tr>' +
        '</tbody></table></div></main></body>',
    );
    expect(claudeAdapter.listProjectConversations?.(doc)).toEqual([]);
    expect(claudeAdapter.projectToolbarMount?.(doc)).toBeNull();
  });

  it('skips a markdown table that precedes the real project table in document order', () => {
    // Document order is the trap: `resolveProjectTable` reads the FIRST match, so a project
    // home that also rendered an assistant-style table above its conversation list would have
    // been walked from the wrong element. The attribute — not the ordering — is what excludes it.
    const doc = docFrom(
      '<body><main>' +
        '<div class="standard-markdown"><table><tbody><tr><td>row one</td></tr></tbody></table></div>' +
        '<table data-cds="Table"><tbody><tr class="group/cdsrow"><td><a href="/chat/aaa" aria-label="First">First</a></td></tr></tbody></table>' +
        '</main></body>',
    );
    expect(claudeAdapter.listProjectConversations?.(doc)).toEqual([
      { id: 'aaa', title: 'First', url: 'https://claude.ai/chat/aaa' },
    ]);
  });
});
