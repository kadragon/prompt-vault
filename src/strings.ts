// Central store for user-facing UI strings. Keeping them in one module makes an
// i18n message catalog a later drop-in rather than a rewrite (conventions.md).

// Labels for the format buttons (Markdown / PDF / JSON / HTML) injected into the
// ChatGPT header.
export const DOWNLOAD_MD_LABEL = 'MD';
export const DOWNLOAD_PDF_LABEL = 'PDF';
export const DOWNLOAD_JSON_LABEL = 'JSON';
export const DOWNLOAD_HTML_LABEL = 'HTML';

// Accessible names for the icon-and-label export buttons (the visible label alone is
// terse; screen readers announce these).
export const DOWNLOAD_MD_ARIA_LABEL = 'Download conversation as Markdown';
export const DOWNLOAD_PDF_ARIA_LABEL = 'Download conversation as PDF';
export const DOWNLOAD_JSON_ARIA_LABEL = 'Download conversation as JSON';
export const DOWNLOAD_HTML_ARIA_LABEL = 'Download conversation as HTML';

// Shown (fail-loud) when the page is not a recognized conversation the extension
// can export.
export const EXPORT_NO_ADAPTER_MESSAGE =
  'This page is not a supported conversation, so there is nothing to export.';

// Generic fallback for an unexpected export failure that is not an ExtractionError.
export const EXPORT_FAILED_MESSAGE = 'Could not export this conversation. Please try again.';

// Shown (fail-loud) when extraction returns a conversation with no messages, so
// there is nothing worth downloading (AGENTS.md #4).
export const EXPORT_EMPTY_MESSAGE =
  'This conversation has no messages, so there is nothing to export.';

// --- Bulk export (select several sidebar conversations and download them all) ---

// The toolbar button that opens the bulk-export selection panel.
export const DOWNLOAD_BULK_LABEL = 'Bulk';
export const DOWNLOAD_BULK_ARIA_LABEL = 'Export multiple conversations';

// Selection-panel chrome.
export const BULK_PANEL_TITLE = 'Export multiple conversations';
export const BULK_PANEL_FORMAT_LABEL = 'Format';
export const BULK_PANEL_SELECT_ALL = 'Select all';
export const BULK_PANEL_CANCEL = 'Cancel';
export const BULK_PANEL_CLOSE = 'Close';

// Shown when the history sidebar lists no conversations to choose from (fail-loud:
// the panel opens but makes clear there is nothing to export rather than showing an
// empty, actionless list).
export const BULK_EMPTY_MESSAGE = 'No conversations were found in the sidebar to export.';

// Shown (fail-loud) when the current page's adapter does not support bulk export.
export const BULK_UNSUPPORTED_MESSAGE = 'Bulk export is not available on this page.';

/** Export-button label with the current selected count, e.g. "Export 3 selected". */
export function bulkExportButtonLabel(selectedCount: number): string {
  return `Export ${selectedCount} selected`;
}

/** In-progress line shown while a batch runs, e.g. "Exporting 2 of 5: My chat". */
export function bulkProgressMessage(current: number, total: number, title: string): string {
  return `Exporting ${current} of ${total}: ${title}`;
}

/**
 * Final summary line after a batch, e.g. "Saved 4 of 5. 1 failed." Kept a single
 * sentence; the per-failure titles are listed separately by the panel.
 */
export function bulkSummaryMessage(succeeded: number, total: number, failedCount: number): string {
  const base = `Saved ${succeeded} of ${total}.`;
  return failedCount > 0 ? `${base} ${failedCount} failed.` : base;
}
