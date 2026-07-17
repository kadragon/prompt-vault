// Central store for user-facing UI strings. Keeping them in one module makes an
// i18n message catalog a later drop-in rather than a rewrite (conventions.md).

// Labels for the two format buttons (Markdown / PDF) injected top-right.
export const DOWNLOAD_MD_LABEL = 'MD';
export const DOWNLOAD_PDF_LABEL = 'PDF';

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
