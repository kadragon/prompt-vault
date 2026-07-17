// Options-page view: builds the settings form and wires each control to a `save` callback.
// Kept free of chrome.storage and the global `document` (both are injected — `doc` for the
// DOM, `save` for persistence) so it is unit-testable under a parsed document, exactly like
// the toolbar (src/content/mount.ts) and bulk panel (src/content/bulk-panel.ts). The wiring
// to real storage lives in main.ts.

import type { ExportFormat } from '../content/save-conversation';
import { FORMAT_KEYS, type ToolbarSettings } from '../settings/store';
import {
  DOWNLOAD_HTML_LABEL,
  DOWNLOAD_JSON_LABEL,
  DOWNLOAD_MD_LABEL,
  DOWNLOAD_PDF_LABEL,
  OPTIONS_BULK_LABEL,
  OPTIONS_FORMATS_LABEL,
  OPTIONS_HEADING,
  OPTIONS_MIN_FORMAT_NOTE,
  OPTIONS_SAVED_NOTE,
  OPTIONS_TITLE,
} from '../strings';

// Reuse the toolbar's own format labels (MD/PDF/JSON/HTML) so the options list names each
// format exactly as its toolbar button does — no separate strings to keep in sync.
const FORMAT_LABELS: Record<ExportFormat, string> = {
  md: DOWNLOAD_MD_LABEL,
  pdf: DOWNLOAD_PDF_LABEL,
  json: DOWNLOAD_JSON_LABEL,
  html: DOWNLOAD_HTML_LABEL,
};

function checkbox(doc: Document, id: string, checked: boolean): HTMLInputElement {
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  return input;
}

function labeledRow(doc: Document, input: HTMLInputElement, text: string): HTMLLabelElement {
  const label = doc.createElement('label');
  label.htmlFor = input.id;
  label.append(input, doc.createTextNode(text));
  return label;
}

/**
 * Render the settings form into `app`. Every change is persisted immediately via `save`
 * (passed a fresh snapshot, never the internal working copy). At least one export format
 * must stay enabled: unchecking the last one is rejected — the checkbox is reverted, a note
 * is shown, and `save` is NOT called — so the persisted value can never hide every format.
 */
export function renderOptions(
  doc: Document,
  app: HTMLElement,
  settings: ToolbarSettings,
  save: (settings: ToolbarSettings) => void,
): void {
  doc.title = OPTIONS_TITLE;

  const heading = doc.createElement('h1');
  heading.textContent = OPTIONS_HEADING;

  // Format checklist.
  const fieldset = doc.createElement('fieldset');
  const legend = doc.createElement('legend');
  legend.textContent = OPTIONS_FORMATS_LABEL;
  fieldset.appendChild(legend);

  const note = doc.createElement('p');
  note.id = 'note';

  // Working copy mutated by the handlers; a snapshot of it is persisted on every change.
  const current: ToolbarSettings = { formats: { ...settings.formats }, bulk: settings.bulk };

  const showNote = (text: string, isError: boolean): void => {
    note.textContent = text;
    note.classList.toggle('error', isError);
  };

  const persist = (): void => {
    save({ formats: { ...current.formats }, bulk: current.bulk });
    showNote(OPTIONS_SAVED_NOTE, false);
  };

  for (const key of FORMAT_KEYS) {
    const box = checkbox(doc, `format-${key}`, current.formats[key]);
    box.addEventListener('change', () => {
      // Guard the min-one invariant: reject unchecking the last enabled format.
      const enabledCount = FORMAT_KEYS.filter((k) => current.formats[k]).length;
      if (!box.checked && enabledCount <= 1) {
        box.checked = true;
        showNote(OPTIONS_MIN_FORMAT_NOTE, true);
        return;
      }
      current.formats[key] = box.checked;
      persist();
    });
    fieldset.appendChild(labeledRow(doc, box, FORMAT_LABELS[key]));
  }

  // Bulk toggle (independent of the min-one format rule).
  const bulkBox = checkbox(doc, 'bulk', current.bulk);
  bulkBox.addEventListener('change', () => {
    current.bulk = bulkBox.checked;
    persist();
  });
  const bulkRow = labeledRow(doc, bulkBox, OPTIONS_BULK_LABEL);

  app.append(heading, fieldset, bulkRow, note);
}
