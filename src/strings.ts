// Central store for user-facing UI strings. Strings resolve through
// chrome.i18n.getMessage(), which selects the message keyed to the browser's UI
// language from the catalog in _locales/{en,ko}/messages.json. No page-detection
// or in-app toggle — locale follows the browser, per chrome.i18n's native behavior.

const m = (key: string, substitutions?: string[]): string => chrome.i18n.getMessage(key, substitutions);

// Labels for the format buttons (Markdown / PDF / JSON / HTML) injected into the
// ChatGPT header.
export const DOWNLOAD_MD_LABEL = m('downloadMdLabel');
export const DOWNLOAD_PDF_LABEL = m('downloadPdfLabel');
export const DOWNLOAD_JSON_LABEL = m('downloadJsonLabel');
export const DOWNLOAD_HTML_LABEL = m('downloadHtmlLabel');

// Accessible names for the icon-and-label export buttons (the visible label alone is
// terse; screen readers announce these).
export const DOWNLOAD_MD_ARIA_LABEL = m('downloadMdAriaLabel');
export const DOWNLOAD_PDF_ARIA_LABEL = m('downloadPdfAriaLabel');
export const DOWNLOAD_JSON_ARIA_LABEL = m('downloadJsonAriaLabel');
export const DOWNLOAD_HTML_ARIA_LABEL = m('downloadHtmlAriaLabel');

// Shown (fail-loud) when the page is not a recognized conversation the extension
// can export.
export const EXPORT_NO_ADAPTER_MESSAGE = m('exportNoAdapterMessage');

// Generic fallback for an unexpected export failure that is not an ExtractionError.
export const EXPORT_FAILED_MESSAGE = m('exportFailedMessage');

// Shown (fail-loud) when extraction returns a conversation with no messages, so
// there is nothing worth downloading (AGENTS.md #4).
export const EXPORT_EMPTY_MESSAGE = m('exportEmptyMessage');

// --- Bulk export (select several sidebar conversations and download them all) ---

// The toolbar button that opens the bulk-export selection panel.
export const DOWNLOAD_BULK_LABEL = m('downloadBulkLabel');
export const DOWNLOAD_BULK_ARIA_LABEL = m('downloadBulkAriaLabel');

// Selection-panel chrome.
export const BULK_PANEL_TITLE = m('bulkPanelTitle');
export const BULK_PANEL_FORMAT_LABEL = m('bulkPanelFormatLabel');
export const BULK_PANEL_SELECT_ALL = m('bulkPanelSelectAll');
export const BULK_PANEL_CANCEL = m('bulkPanelCancel');
export const BULK_PANEL_CLOSE = m('bulkPanelClose');

// Shown when the history sidebar lists no conversations to choose from (fail-loud:
// the panel opens but makes clear there is nothing to export rather than showing an
// empty, actionless list).
export const BULK_EMPTY_MESSAGE = m('bulkEmptyMessage');

// Shown (fail-loud) when the current page's adapter does not support bulk export.
export const BULK_UNSUPPORTED_MESSAGE = m('bulkUnsupportedMessage');

/** Export-button label with the current selected count, e.g. "Export 3 selected". */
export function bulkExportButtonLabel(selectedCount: number): string {
  return m('bulkExportButtonLabel', [String(selectedCount)]);
}

/** In-progress line shown while a batch runs, e.g. "Exporting 2 of 5: My chat". */
export function bulkProgressMessage(current: number, total: number, title: string): string {
  return m('bulkProgressMessage', [String(current), String(total), title]);
}

/**
 * Final summary line after a batch, e.g. "Saved 4 of 5. 1 failed." Kept a single
 * sentence; the per-failure titles are listed separately by the panel.
 */
export function bulkSummaryMessage(succeeded: number, total: number, failedCount: number): string {
  const saved = m('bulkSummarySaved', [String(succeeded), String(total)]);
  return failedCount > 0 ? `${saved} ${m('bulkSummaryFailed', [String(failedCount)])}` : saved;
}
