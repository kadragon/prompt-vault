// Central store for user-facing UI strings. Keeping them in one module makes an
// i18n message catalog a later drop-in rather than a rewrite (conventions.md).

export const DOWNLOAD_BUTTON_LABEL = 'Download';

// Shown (fail-loud) when the page is not a recognized conversation the extension
// can export.
export const EXPORT_NO_ADAPTER_MESSAGE =
  'This page is not a supported conversation, so there is nothing to export.';

// Generic fallback for an unexpected export failure that is not an ExtractionError.
export const EXPORT_FAILED_MESSAGE = 'Could not export this conversation. Please try again.';
