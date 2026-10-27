// The copy-for-sharing review modal (docs/design/share-copy-export.md): lists the emails
// and phone numbers detected in the current conversation (all checked, so all masked, by
// default), takes the user's own terms to mask, previews the resulting Markdown copy, and
// saves it as a separate file. Provider-agnostic — the caller (src/content/mount.ts) hands
// in an already-extracted Conversation and how to download — so this module is pure UI and
// unit-testable under a parsed document. Self-styled like the bulk panel.
//
// Privacy (Golden Principle #1): the term list and the candidate choices live only in this
// modal's closure and are dropped on close. Nothing here touches chrome.storage,
// localStorage, or the network; the original Conversation is never mutated.

import type { Conversation } from '../core/conversation';
import { createShareCopyWithCount, findShareCandidates, type ShareCandidate } from '../core/share-copy';
import { buildShareFilename } from '../export/filename';
import { toMarkdown } from '../export/markdown';
import { restoreFocus, trapTab } from './modal-focus';
import {
  BULK_PANEL_SELECT_ALL,
  EXPORT_FAILED_MESSAGE,
  SHARE_KIND_EMAIL,
  SHARE_KIND_PHONE,
  SHARE_NEUTRAL_TITLE,
  SHARE_PANEL_ADD_TERM,
  SHARE_PANEL_CANCEL,
  SHARE_PANEL_DETECTED_LABEL,
  SHARE_PANEL_NO_CANDIDATES,
  SHARE_PANEL_PREVIEW_LABEL,
  SHARE_PANEL_SAVE,
  SHARE_PANEL_TERM_LABEL,
  SHARE_PANEL_TITLE,
  SHARE_PANEL_WARNING,
  sharePanelMaskedCount,
  sharePanelOccurrences,
  sharePanelRemoveTermLabel,
} from '../strings';

// Stable id so the panel mounts at most once and tests can locate it. Distinct from the
// toolbar's CONTAINER_ID, which removeButtons() wipes on every SPA href change.
export const SHARE_PANEL_ID = 'prompt-vault-share-panel';
// Ids the dialog points at for its accessible description, and the controls' labels use.
const WARNING_ID = 'prompt-vault-share-panel-warning';
const TERM_INPUT_ID = 'prompt-vault-share-panel-term';
const PREVIEW_ID = 'prompt-vault-share-panel-preview';

export interface SharePanelDeps {
  /** The extracted, non-empty conversation to make a copy of. Never mutated. */
  conversation: Conversation;
  /** Saves the copy; injected so tests can observe it without a real download. */
  download: (filename: string, text: string) => void;
  /** The moment the panel opened, for the filename date. */
  now: Date;
  /**
   * The control focus returns to on close. Passed in because the toolbar disables its buttons
   * while extracting, which drops focus to `<body>` before the panel opens; defaults to
   * whatever is focused at open.
   */
  opener?: Element | null;
}

const KIND_LABEL: Record<ShareCandidate['kind'], string> = {
  email: SHARE_KIND_EMAIL,
  phone: SHARE_KIND_PHONE,
};

/**
 * Open the review modal. A no-op if it is already open. Opening is a user gesture (the
 * toolbar click), so taking focus here is correct (docs/conventions.md → Injected page UI).
 */
export function openSharePanel(doc: Document, deps: SharePanelDeps): void {
  if (doc.getElementById(SHARE_PANEL_ID)) return;
  const opener = deps.opener ?? doc.activeElement;

  const candidates = findShareCandidates(deps.conversation);
  const excluded = new Set<ShareCandidate>();
  const terms: string[] = [];

  const backdrop = doc.createElement('div');
  backdrop.id = SHARE_PANEL_ID;
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
  dialog.setAttribute('aria-label', SHARE_PANEL_TITLE);
  dialog.setAttribute('aria-describedby', WARNING_ID);
  // Focusable so focus can move into the modal on open (aria-modal contract).
  dialog.tabIndex = -1;
  Object.assign(dialog.style, {
    display: 'flex',
    flexDirection: 'column',
    width: 'min(720px, 94vw)',
    maxHeight: '88vh',
    background: '#ffffff',
    color: '#111111',
    borderRadius: '12px',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
    overflow: 'hidden',
  });
  backdrop.appendChild(dialog);

  // Escape is bound on the document (focus may still sit on the toolbar button), so every
  // teardown path must unbind it — a detached panel's listener would otherwise keep firing.
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
    else trapTab(dialog, e);
  };
  const close = (): void => {
    doc.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    restoreFocus(opener);
  };
  doc.addEventListener('keydown', onKeydown);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  // Header: title and the warning that detection is incomplete.
  const header = doc.createElement('div');
  Object.assign(header.style, { padding: '16px 20px', borderBottom: '1px solid #e5e5e5' });
  const heading = doc.createElement('h2');
  heading.textContent = SHARE_PANEL_TITLE;
  Object.assign(heading.style, { margin: '0', fontSize: '16px', fontWeight: '600' });
  const warning = doc.createElement('p');
  warning.id = WARNING_ID;
  warning.textContent = SHARE_PANEL_WARNING;
  Object.assign(warning.style, { margin: '6px 0 0', fontSize: '13px', color: '#8a4b00' });
  header.append(heading, warning);

  const body = doc.createElement('div');
  Object.assign(body.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '14px 20px',
    overflowY: 'auto',
  });

  // Preview: re-rendered from the original conversation on every change.
  const preview = doc.createElement('pre');
  preview.id = PREVIEW_ID;
  Object.assign(preview.style, {
    margin: '0',
    padding: '10px 12px',
    maxHeight: '36vh',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: '12px',
    lineHeight: '1.5',
    background: '#f6f6f6',
    border: '1px solid #e5e5e5',
    borderRadius: '8px',
  });
  // How many values the copy masks, beside the preview label: a summary to check a long
  // preview against. Polite live region, so a screen reader hears it change.
  const maskedCount = doc.createElement('span');
  maskedCount.setAttribute('aria-live', 'polite');
  Object.assign(maskedCount.style, { fontSize: '12px', fontWeight: '400', color: '#555555' });
  const refresh = (): void => {
    const { copy, masked } = createShareCopyWithCount(deps.conversation, {
      excluded: [...excluded],
      manualTerms: terms,
      neutralTitle: SHARE_NEUTRAL_TITLE,
    });
    preview.textContent = toMarkdown(copy);
    maskedCount.textContent = sharePanelMaskedCount(masked);
  };

  body.append(
    candidateSection(doc, candidates, excluded, refresh),
    termSection(doc, terms, refresh),
    previewSection(doc, preview, maskedCount),
  );

  // Footer: Cancel / Save. Save writes exactly the text the preview shows.
  const footer = doc.createElement('div');
  Object.assign(footer.style, {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '14px 20px',
    borderTop: '1px solid #e5e5e5',
  });
  const cancel = styledButton(doc, SHARE_PANEL_CANCEL, 'secondary');
  cancel.addEventListener('click', close);
  const save = styledButton(doc, SHARE_PANEL_SAVE, 'primary');
  save.addEventListener('click', () => {
    try {
      deps.download(buildShareFilename(deps.conversation, deps.now), preview.textContent ?? '');
    } catch {
      // Fail loud (AGENTS.md #4): keep the modal and its choices so the user can retry,
      // rather than leave a Save click that silently did nothing.
      alert(EXPORT_FAILED_MESSAGE);
      return;
    }
    close();
  });
  footer.append(cancel, save);

  dialog.append(header, body, footer);
  refresh();
  doc.body.appendChild(backdrop);
  dialog.focus();
}

/**
 * The detected-candidate checklist: checked means masked; unchecking keeps the text.
 * Identical values (same kind and text) share one row with an occurrence count, so keeping a
 * sample address that recurs through a long conversation is one click, not one per mention.
 */
function candidateSection(
  doc: Document,
  candidates: ShareCandidate[],
  excluded: Set<ShareCandidate>,
  refresh: () => void,
): HTMLElement {
  // With nothing detected there is nothing to uncheck, so the checklist heading (which says to
  // uncheck) is replaced by a plain note pointing at the manual-term field.
  if (candidates.length === 0) {
    const none = doc.createElement('p');
    none.textContent = SHARE_PANEL_NO_CANDIDATES;
    Object.assign(none.style, { margin: '0', fontSize: '13px', color: '#555555' });
    return none;
  }

  const groups = new Map<string, ShareCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}\u0000${candidate.text}`;
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }

  const section = doc.createElement('fieldset');
  Object.assign(section.style, { margin: '0', padding: '0', border: 'none' });
  const legend = doc.createElement('legend');
  legend.textContent = SHARE_PANEL_DETECTED_LABEL;
  Object.assign(legend.style, { padding: '0', marginBottom: '6px', fontSize: '13px', fontWeight: '600' });
  section.appendChild(legend);

  const rowBoxes: HTMLInputElement[] = [];
  const selectAll = checkbox(doc);
  const syncSelectAll = (): void => {
    const checked = rowBoxes.filter((b) => b.checked).length;
    selectAll.checked = checked === rowBoxes.length;
    selectAll.indeterminate = checked > 0 && checked < rowBoxes.length;
  };
  const setGroup = (members: ShareCandidate[], masked: boolean): void => {
    for (const member of members) {
      if (masked) excluded.delete(member);
      else excluded.add(member);
    }
  };

  const list = doc.createElement('div');
  Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '22vh', overflowY: 'auto' });
  for (const members of groups.values()) {
    const first = members[0];
    const row = doc.createElement('label');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' });
    const box = checkbox(doc);
    box.checked = true;
    box.addEventListener('change', () => {
      setGroup(members, box.checked);
      syncSelectAll();
      refresh();
    });
    rowBoxes.push(box);
    const kind = doc.createElement('span');
    kind.textContent = KIND_LABEL[first.kind];
    Object.assign(kind.style, { minWidth: '72px', color: '#555555' });
    const text = doc.createElement('code');
    text.textContent = first.text;
    Object.assign(text.style, { wordBreak: 'break-all' });
    row.append(box, kind, text);
    if (members.length > 1) {
      const count = doc.createElement('span');
      count.textContent = sharePanelOccurrences(members.length);
      Object.assign(count.style, { color: '#555555' });
      row.appendChild(count);
    }
    list.appendChild(row);
  }

  // Select-all only earns its row when there is more than one row to toggle.
  if (rowBoxes.length > 1) {
    const allRow = doc.createElement('label');
    Object.assign(allRow.style, { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginBottom: '4px', cursor: 'pointer' });
    selectAll.checked = true;
    selectAll.setAttribute('data-prompt-vault-select-all', '');
    selectAll.addEventListener('change', () => {
      for (const [index, members] of [...groups.values()].entries()) {
        rowBoxes[index].checked = selectAll.checked;
        setGroup(members, selectAll.checked);
      }
      selectAll.indeterminate = false;
      refresh();
    });
    allRow.append(selectAll, doc.createTextNode(BULK_PANEL_SELECT_ALL));
    section.appendChild(allRow);
  }
  section.appendChild(list);
  return section;
}

// A checkbox that renders on any host. ChatGPT's CSS gives bare checkboxes
// `appearance: none` and a 0×0 box (measured live 2026-10-27), so the control restores its
// own native rendering and size.
function checkbox(doc: Document): HTMLInputElement {
  const box = doc.createElement('input');
  box.type = 'checkbox';
  Object.assign(box.style, {
    appearance: 'auto',
    display: 'inline-block',
    flex: '0 0 auto',
    width: '16px',
    height: '16px',
    margin: '0',
    accentColor: '#10a37f',
    cursor: 'pointer',
  });
  return box;
}

/** The manual-term input, its Add control, and the removable list of added terms. */
function termSection(doc: Document, terms: string[], refresh: () => void): HTMLElement {
  const section = doc.createElement('div');
  const label = doc.createElement('label');
  label.htmlFor = TERM_INPUT_ID;
  label.textContent = SHARE_PANEL_TERM_LABEL;
  Object.assign(label.style, { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '600' });

  const row = doc.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '8px' });
  const input = doc.createElement('input');
  input.type = 'text';
  input.id = TERM_INPUT_ID;
  input.autocomplete = 'off';
  Object.assign(input.style, {
    flex: '1',
    padding: '6px 10px',
    fontSize: '14px',
    fontFamily: 'inherit',
    color: '#111111',
    background: '#ffffff',
    border: '1px solid #d0d0d0',
    borderRadius: '8px',
  });
  const add = styledButton(doc, SHARE_PANEL_ADD_TERM, 'secondary');
  row.append(input, add);

  const chips = doc.createElement('ul');
  Object.assign(chips.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '8px 0 0', padding: '0', listStyle: 'none' });

  const renderChips = (): void => {
    chips.replaceChildren(
      ...terms.map((term, index) => {
        const chip = doc.createElement('li');
        Object.assign(chip.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 4px 2px 10px',
          fontSize: '13px',
          background: '#eef6f3',
          border: '1px solid #cfe6dd',
          borderRadius: '999px',
        });
        const text = doc.createElement('span');
        text.textContent = term;
        const remove = doc.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', sharePanelRemoveTermLabel(term));
        remove.title = sharePanelRemoveTermLabel(term);
        Object.assign(remove.style, {
          border: 'none',
          background: 'transparent',
          color: '#111111',
          fontSize: '15px',
          lineHeight: '1',
          cursor: 'pointer',
        });
        remove.addEventListener('click', () => {
          terms.splice(index, 1);
          renderChips();
          refresh();
        });
        chip.append(text, remove);
        return chip;
      }),
    );
  };

  const addTerm = (): void => {
    const term = input.value.trim();
    input.value = '';
    if (term === '' || terms.includes(term)) return;
    terms.push(term);
    renderChips();
    refresh();
  };
  add.addEventListener('click', addTerm);
  input.addEventListener('keydown', (e) => {
    // Enter adds; isComposing keeps an IME confirming a Hangul/kana syllable from adding early.
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      addTerm();
    }
  });

  section.append(label, row, chips);
  return section;
}

function previewSection(doc: Document, preview: HTMLElement, maskedCount: HTMLElement): HTMLElement {
  const section = doc.createElement('div');
  const header = doc.createElement('div');
  Object.assign(header.style, { display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '6px' });
  const label = doc.createElement('div');
  label.id = `${PREVIEW_ID}-label`;
  label.textContent = SHARE_PANEL_PREVIEW_LABEL;
  Object.assign(label.style, { fontSize: '13px', fontWeight: '600' });
  header.append(label, maskedCount);
  preview.setAttribute('aria-labelledby', label.id);
  // Scrollable, so keyboard users must be able to reach it to read the whole copy.
  preview.tabIndex = 0;
  section.append(header, preview);
  return section;
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
