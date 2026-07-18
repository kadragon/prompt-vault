import { describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import type { SidebarConversation } from '../../src/core/sidebar';
import type { ExportFormat } from '../../src/content/save-conversation';
import type { BulkExportSummary } from '../../src/content/bulk-export';
import { openBulkPanel, BULK_PANEL_ID, type BulkPanelDeps } from '../../src/content/bulk-panel';

function freshDoc(): Document {
  const window = new Window();
  window.document.write('<body></body>');
  return window.document as unknown as Document;
}

const CONVS: SidebarConversation[] = [
  { id: 'a', title: 'Alpha', url: 'https://chatgpt.com/c/a' },
  { id: 'b', title: 'Beta', url: 'https://chatgpt.com/c/b' },
  { id: 'c', title: 'Gamma', url: 'https://chatgpt.com/c/c' },
];

function panelOf(doc: Document): HTMLElement {
  const panel = doc.getElementById(BULK_PANEL_ID);
  if (!panel) throw new Error('panel not mounted');
  return panel;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text);
  if (!button) throw new Error(`no button "${text}"`);
  return button;
}

function checkboxes(root: ParentNode): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
}

function check(box: HTMLInputElement): void {
  box.checked = true;
  box.dispatchEvent(new (box.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event('change'));
}

/** Deps whose `run` records its call and resolves with a caller-supplied summary. */
function deps(summary: BulkExportSummary, list: SidebarConversation[] = CONVS): BulkPanelDeps & {
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(
    (
      selected: SidebarConversation[],
      _format: ExportFormat,
      onProgress: (c: number, t: number, title: string) => void,
    ) => {
      onProgress(0, selected.length, selected[0].title);
      return Promise.resolve(summary);
    },
  );
  return { listConversations: () => list, run };
}

/** Deps whose `run` stays pending until the returned `resolve` is called. */
function pendingDeps(list: SidebarConversation[] = CONVS): BulkPanelDeps & {
  run: ReturnType<typeof vi.fn>;
  resolve: (summary: BulkExportSummary) => void;
} {
  let resolveRun!: (summary: BulkExportSummary) => void;
  const run = vi.fn(() => new Promise<BulkExportSummary>((res) => (resolveRun = res)));
  return { listConversations: () => list, run, resolve: (summary) => resolveRun(summary) };
}

function pressEscape(doc: Document): void {
  const view = doc.defaultView as unknown as { KeyboardEvent: typeof KeyboardEvent };
  doc.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape' }));
}

function clickBackdrop(backdrop: HTMLElement): void {
  const view = backdrop.ownerDocument.defaultView as unknown as { Event: typeof Event };
  backdrop.dispatchEvent(new view.Event('click'));
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('openBulkPanel', () => {
  it('lists every conversation as a checkbox row with its title', () => {
    const doc = freshDoc();
    openBulkPanel(doc, deps({ total: 0, succeeded: 0, failed: [] }));
    const panel = panelOf(doc);
    expect(checkboxes(panel)).toHaveLength(CONVS.length + 1); // +1 for select-all
    expect(panel.textContent).toContain('Alpha');
    expect(panel.textContent).toContain('Beta');
    expect(panel.textContent).toContain('Gamma');
  });

  it('is idempotent — a second open does not stack a second panel', () => {
    const doc = freshDoc();
    const d = deps({ total: 0, succeeded: 0, failed: [] });
    openBulkPanel(doc, d);
    openBulkPanel(doc, d);
    expect(doc.querySelectorAll(`#${BULK_PANEL_ID}`)).toHaveLength(1);
  });

  it('shows the empty state (no actionable list) when the sidebar lists nothing', () => {
    const doc = freshDoc();
    openBulkPanel(doc, deps({ total: 0, succeeded: 0, failed: [] }, []));
    const panel = panelOf(doc);
    expect(panel.textContent).toContain('No conversations were found to export');
    expect(checkboxes(panel)).toHaveLength(0);
  });

  it('disables Export until at least one conversation is selected', () => {
    const doc = freshDoc();
    openBulkPanel(doc, deps({ total: 0, succeeded: 0, failed: [] }));
    const panel = panelOf(doc);
    expect(buttonByText(panel, 'Export 0 selected').disabled).toBe(true);

    check(checkboxes(panel)[1]); // first conversation (index 0 is select-all)
    expect(buttonByText(panel, 'Export 1 selected').disabled).toBe(false);
  });

  it('select-all checks every conversation and updates the Export count', () => {
    const doc = freshDoc();
    openBulkPanel(doc, deps({ total: 0, succeeded: 0, failed: [] }));
    const panel = panelOf(doc);
    check(checkboxes(panel)[0]); // the select-all box
    expect(checkboxes(panel).every((b) => b.checked)).toBe(true);
    expect(buttonByText(panel, `Export ${CONVS.length} selected`)).toBeTruthy();
  });

  it('runs the batch for exactly the selected conversations in the chosen format', async () => {
    const doc = freshDoc();
    const d = deps({ total: 2, succeeded: 2, failed: [] });
    openBulkPanel(doc, d);
    const panel = panelOf(doc);

    (panel.querySelector('select') as HTMLSelectElement).value = 'pdf';
    check(checkboxes(panel)[1]); // Alpha
    check(checkboxes(panel)[3]); // Gamma
    buttonByText(panel, 'Export 2 selected').click();
    await flush();

    expect(d.run).toHaveBeenCalledTimes(1);
    const [selected, format] = d.run.mock.calls[0] as [SidebarConversation[], ExportFormat, unknown];
    expect(selected.map((c) => c.id)).toEqual(['a', 'c']);
    expect(format).toBe('pdf');
  });

  it('streams progress then shows the summary, and lists failed titles', async () => {
    const doc = freshDoc();
    const summary: BulkExportSummary = {
      total: 2,
      succeeded: 1,
      failed: [{ title: 'Beta', error: 'Timed out opening' }],
    };
    openBulkPanel(doc, deps(summary));
    const panel = panelOf(doc);

    check(checkboxes(panel)[1]);
    check(checkboxes(panel)[2]);
    buttonByText(panel, 'Export 2 selected').click();
    await flush();

    expect(panel.textContent).toContain('Saved 1 of 2.');
    expect(panel.textContent).toContain('1 failed.');
    expect(panel.textContent).toContain('Beta: Timed out opening');
    // After the run, the only action left is Close.
    expect(buttonByText(panel, 'Close')).toBeTruthy();
  });

  it('closes on Cancel', () => {
    const doc = freshDoc();
    openBulkPanel(doc, deps({ total: 0, succeeded: 0, failed: [] }));
    buttonByText(panelOf(doc), 'Cancel').click();
    expect(doc.getElementById(BULK_PANEL_ID)).toBeNull();
  });

  it('closes on Escape via a document-level listener (focus need not be inside the panel)', () => {
    const doc = freshDoc();
    openBulkPanel(doc, deps({ total: 0, succeeded: 0, failed: [] }));
    expect(doc.getElementById(BULK_PANEL_ID)).not.toBeNull();
    pressEscape(doc);
    expect(doc.getElementById(BULK_PANEL_ID)).toBeNull();
  });

  it('cannot be dismissed mid-batch — the running batch would keep navigating the tab unseen', async () => {
    const doc = freshDoc();
    const d = pendingDeps();
    openBulkPanel(doc, d);
    const panel = panelOf(doc);
    check(checkboxes(panel)[1]);
    buttonByText(panel, 'Export 1 selected').click();
    await flush();

    // Batch in flight (run has not resolved): backdrop click and Escape are inert.
    clickBackdrop(panel);
    expect(doc.getElementById(BULK_PANEL_ID)).not.toBeNull();
    pressEscape(doc);
    expect(doc.getElementById(BULK_PANEL_ID)).not.toBeNull();

    // Once the batch settles, the repurposed Close works again.
    d.resolve({ total: 1, succeeded: 1, failed: [] });
    await flush();
    buttonByText(panel, 'Close').click();
    expect(doc.getElementById(BULK_PANEL_ID)).toBeNull();
  });
});
