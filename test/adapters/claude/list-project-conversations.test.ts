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
      <table>
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
    const doc = docFrom('<body><main><table><tbody><tr class="group/cdsrow"><td>broken</td></tr></tbody></table></main></body>');
    expect(() => claudeAdapter.listProjectConversations?.(doc)).toThrow(ExtractionError);
  });

  it('fails loud when a project chat anchor has no title', () => {
    const doc = docFrom('<body><main><table><tbody><tr><td><a href="/chat/aaa"></a></td></tr></tbody></table></main></body>');
    expect(() => claudeAdapter.listProjectConversations?.(doc)).toThrow(ExtractionError);
  });
});
