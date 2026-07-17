// The bulk-export selection panel: a self-contained modal listing the sidebar
// conversations with checkboxes, a format picker, and an Export action that drives a
// batch and reports a summary. Provider-agnostic — it knows nothing about ChatGPT's
// DOM; the caller (src/content/mount.ts) injects how to list conversations and how to
// run the batch, so this module is pure UI + orchestration and unit-testable under a
// parsed document. Fully self-styled (like the overlay fallback) so it stays legible
// regardless of the host page's CSS, and survives the host SPA re-rendering during
// the cross-conversation navigation a batch performs (it is mounted on <body>).

import type { SidebarConversation } from '../core/sidebar';
import type { ExportFormat } from './save-conversation';
import type { BulkExportSummary } from './bulk-export';
import {
  BULK_EMPTY_MESSAGE,
  BULK_PANEL_CANCEL,
  BULK_PANEL_CLOSE,
  BULK_PANEL_FORMAT_LABEL,
  BULK_PANEL_SELECT_ALL,
  BULK_PANEL_TITLE,
  bulkExportButtonLabel,
  bulkProgressMessage,
  bulkSummaryMessage,
} from '../strings';

// Stable id so the panel mounts at most once and tests can locate it.
export const BULK_PANEL_ID = 'prompt-vault-bulk-panel';

// The formats the picker offers, in display order (labels are self-explanatory and
// need no i18n string of their own — they are the file extensions).
const FORMAT_OPTIONS: ReadonlyArray<{ value: ExportFormat; label: string }> = [
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
  { value: 'json', label: 'JSON (.json)' },
  { value: 'html', label: 'HTML (.html)' },
];

export interface BulkPanelDeps {
  /** Enumerate the conversations to offer for selection. */
  listConversations: () => SidebarConversation[];
  /**
   * Run the batch for the chosen conversations and format, reporting per-item
   * progress via `onProgress(current1Based, total, title)`. Resolves with the summary;
   * isolates its own failures (never rejects for a single bad conversation).
   */
  run: (
    selected: SidebarConversation[],
    format: ExportFormat,
    onProgress: (current: number, total: number, title: string) => void,
  ) => Promise<BulkExportSummary>;
}

/**
 * Open the bulk-export panel on `doc`. Idempotent: if a panel is already mounted it is
 * left in place. When the sidebar lists nothing, the panel still opens but shows the
 * empty-state message (fail-loud — never a silent no-op).
 */
export function openBulkPanel(doc: Document, deps: BulkPanelDeps): void {
  if (doc.getElementById(BULK_PANEL_ID)) return;

  const conversations = deps.listConversations();
  const { backdrop, dialog, close, setRunning } = buildShell(doc);

  if (conversations.length === 0) {
    renderEmptyState(doc, backdrop, close);
  } else {
    renderSelection(doc, backdrop, close, setRunning, conversations, deps);
  }

  doc.body.appendChild(backdrop);
  // Move focus into the modal so keyboard users are placed inside it (aria-modal) and
  // Escape works immediately rather than only after tabbing to a control.
  dialog.focus();
}

/** The modal shell: a full-screen backdrop holding a centered dialog, plus Escape-to-close. */
function buildShell(doc: Document): {
  backdrop: HTMLDivElement;
  dialog: HTMLDivElement;
  close: () => void;
  setRunning: (running: boolean) => void;
} {
  const backdrop = doc.createElement('div');
  backdrop.id = BULK_PANEL_ID;
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.5)',
    fontFamily: 'inherit',
  });

  const dialog = doc.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', BULK_PANEL_TITLE);
  // Focusable so the caller can move focus into the modal on open (aria-modal contract).
  dialog.tabIndex = -1;
  Object.assign(dialog.style, {
    display: 'flex',
    flexDirection: 'column',
    width: 'min(560px, 92vw)',
    maxHeight: '82vh',
    background: '#ffffff',
    color: '#111111',
    borderRadius: '12px',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
    overflow: 'hidden',
  });
  backdrop.appendChild(dialog);

  // While a batch runs the modal must stay put: the batch navigates the host tab across
  // conversations in the background, so silently removing the modal would strand the run
  // with no visible progress or summary. `running` gates the dismiss paths (backdrop
  // click, Escape); the in-run controls are disabled separately and Cancel is repurposed
  // into Close once the batch settles.
  let running = false;
  const setRunning = (value: boolean): void => {
    running = value;
  };
  // Escape is bound on the document rather than the backdrop: a backdrop-scoped listener
  // only fires while focus is inside it, but on open focus may sit on the toolbar button
  // that triggered the panel, so document scope makes Escape work regardless of focus.
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const close = (): void => {
    if (running) return;
    doc.removeEventListener('keydown', onKeydown);
    backdrop.remove();
  };
  doc.addEventListener('keydown', onKeydown);
  // Click on the backdrop (outside the dialog) closes; clicks inside do not bubble out.
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  return { backdrop, dialog, close, setRunning };
}

/** Section helpers keep the two render paths (empty / selection) readable. */
function makeHeader(doc: Document): HTMLElement {
  const header = doc.createElement('div');
  Object.assign(header.style, { padding: '16px 20px', borderBottom: '1px solid #e5e5e5' });
  const h = doc.createElement('h2');
  h.textContent = BULK_PANEL_TITLE;
  Object.assign(h.style, { margin: '0', fontSize: '16px', fontWeight: '600' });
  header.appendChild(h);
  return header;
}

function styledButton(doc: Document, label: string, variant: 'primary' | 'secondary'): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = label;
  Object.assign(button.style, {
    padding: '8px 16px',
    fontSize: '14px',
    fontFamily: 'inherit',
    borderRadius: '8px',
    cursor: 'pointer',
    border: variant === 'primary' ? 'none' : '1px solid #d0d0d0',
    color: variant === 'primary' ? '#ffffff' : '#111111',
    background: variant === 'primary' ? '#10a37f' : '#ffffff',
  });
  return button;
}

function renderEmptyState(doc: Document, backdrop: HTMLElement, close: () => void): void {
  const dialog = backdrop.firstElementChild as HTMLElement;
  dialog.appendChild(makeHeader(doc));

  const body = doc.createElement('div');
  Object.assign(body.style, { padding: '20px' });
  const msg = doc.createElement('p');
  msg.textContent = BULK_EMPTY_MESSAGE;
  Object.assign(msg.style, { margin: '0', fontSize: '14px' });
  body.appendChild(msg);
  dialog.appendChild(body);

  const footer = makeFooter(doc);
  const closeBtn = styledButton(doc, BULK_PANEL_CLOSE, 'secondary');
  closeBtn.addEventListener('click', close);
  footer.appendChild(closeBtn);
  dialog.appendChild(footer);
}

function makeFooter(doc: Document): HTMLElement {
  const footer = doc.createElement('div');
  Object.assign(footer.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '14px 20px',
    borderTop: '1px solid #e5e5e5',
  });
  return footer;
}

function renderSelection(
  doc: Document,
  backdrop: HTMLElement,
  close: () => void,
  setRunning: (running: boolean) => void,
  conversations: SidebarConversation[],
  deps: BulkPanelDeps,
): void {
  const dialog = backdrop.firstElementChild as HTMLElement;
  dialog.appendChild(makeHeader(doc));

  // Controls row: format picker + select-all.
  const controls = doc.createElement('div');
  Object.assign(controls.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '12px 20px',
    borderBottom: '1px solid #f0f0f0',
  });

  const formatWrap = doc.createElement('label');
  Object.assign(formatWrap.style, { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' });
  formatWrap.append(`${BULK_PANEL_FORMAT_LABEL}: `);
  const formatSelect = doc.createElement('select');
  Object.assign(formatSelect.style, { fontFamily: 'inherit', fontSize: '14px', padding: '4px 6px' });
  for (const opt of FORMAT_OPTIONS) {
    const option = doc.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    formatSelect.appendChild(option);
  }
  formatWrap.appendChild(formatSelect);

  const selectAllWrap = doc.createElement('label');
  Object.assign(selectAllWrap.style, { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' });
  const selectAll = doc.createElement('input');
  selectAll.type = 'checkbox';
  selectAllWrap.append(selectAll, BULK_PANEL_SELECT_ALL);

  controls.append(formatWrap, selectAllWrap);
  dialog.appendChild(controls);

  // Scrollable conversation checklist.
  const list = doc.createElement('div');
  Object.assign(list.style, { overflowY: 'auto', padding: '8px 20px', flex: '1 1 auto' });
  const checkboxes: HTMLInputElement[] = [];
  for (const conversation of conversations) {
    const row = doc.createElement('label');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '6px 0',
      fontSize: '14px',
      cursor: 'pointer',
    });
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.value = conversation.id;
    const title = doc.createElement('span');
    title.textContent = conversation.title;
    Object.assign(title.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
    row.append(box, title);
    list.appendChild(row);
    checkboxes.push(box);
  }
  dialog.appendChild(list);

  // Status line (progress / summary), hidden until a run starts.
  const status = doc.createElement('div');
  Object.assign(status.style, { padding: '0 20px', fontSize: '13px', color: '#444444' });
  dialog.appendChild(status);

  // Footer: Cancel + Export.
  const footer = makeFooter(doc);
  const cancel = styledButton(doc, BULK_PANEL_CANCEL, 'secondary');
  const exportBtn = styledButton(doc, bulkExportButtonLabel(0), 'primary');
  footer.append(cancel, exportBtn);
  dialog.appendChild(footer);

  const selectedIds = (): Set<string> => new Set(checkboxes.filter((b) => b.checked).map((b) => b.value));
  const refreshExport = (): void => {
    const count = checkboxes.filter((b) => b.checked).length;
    exportBtn.textContent = bulkExportButtonLabel(count);
    exportBtn.disabled = count === 0;
    exportBtn.style.opacity = count === 0 ? '0.5' : '1';
    exportBtn.style.cursor = count === 0 ? 'default' : 'pointer';
  };
  refreshExport();

  selectAll.addEventListener('change', () => {
    for (const b of checkboxes) b.checked = selectAll.checked;
    refreshExport();
  });
  for (const b of checkboxes) {
    b.addEventListener('change', () => {
      selectAll.checked = checkboxes.every((c) => c.checked);
      refreshExport();
    });
  }

  cancel.addEventListener('click', close);
  exportBtn.addEventListener('click', () => {
    const ids = selectedIds();
    const selected = conversations.filter((c) => ids.has(c.id));
    if (selected.length === 0) return;
    void runBatch(doc, {
      selected,
      format: formatSelect.value as ExportFormat,
      deps,
      status,
      controls: [selectAll, formatSelect, exportBtn, cancel, ...checkboxes],
      cancelButton: cancel,
      close,
      setRunning,
    });
  });
}

interface RunBatchArgs {
  selected: SidebarConversation[];
  format: ExportFormat;
  deps: BulkPanelDeps;
  status: HTMLElement;
  /** Every interactive control, disabled for the duration of the run. */
  controls: Array<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>;
  cancelButton: HTMLButtonElement;
  close: () => void;
  /** Toggle the shell's dismiss guard so the modal can't be closed mid-batch. */
  setRunning: (running: boolean) => void;
}

/**
 * Drive the batch: lock the controls, stream progress into `status`, then replace the
 * status with the summary and repurpose Cancel into Close. The batch itself never
 * rejects per item (failures are captured in the summary); an unexpected rejection of
 * the whole run is still surfaced (fail-loud) rather than swallowed.
 */
async function runBatch(doc: Document, args: RunBatchArgs): Promise<void> {
  const { selected, format, deps, status, controls, cancelButton, close, setRunning } = args;
  for (const c of controls) c.disabled = true;
  // Block the dismiss paths (backdrop click / Escape) for the whole batch.
  setRunning(true);

  const onProgress = (current: number, total: number, title: string): void => {
    // `current` arrives zero-based (item about to start); show it 1-based.
    status.textContent = bulkProgressMessage(current + 1, total, title);
  };

  try {
    const summary = await deps.run(selected, format, onProgress);
    renderSummary(doc, status, summary);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    // The batch is done (or errored): the only useful action left is closing.
    setRunning(false);
    cancelButton.disabled = false;
    cancelButton.textContent = BULK_PANEL_CLOSE;
    cancelButton.onclick = close;
  }
}

/** Render the batch summary line plus, when present, the list of failed titles. */
function renderSummary(doc: Document, status: HTMLElement, summary: BulkExportSummary): void {
  status.textContent = '';
  const line = doc.createElement('div');
  line.textContent = bulkSummaryMessage(summary.succeeded, summary.total, summary.failed.length);
  Object.assign(line.style, { fontWeight: '600', marginBottom: summary.failed.length ? '6px' : '0' });
  status.appendChild(line);

  if (summary.failed.length > 0) {
    const failList = doc.createElement('ul');
    Object.assign(failList.style, { margin: '0', paddingLeft: '18px', color: '#b00020' });
    for (const failure of summary.failed) {
      const item = doc.createElement('li');
      item.textContent = `${failure.title}: ${failure.error}`;
      failList.appendChild(item);
    }
    status.appendChild(failList);
  }
}
