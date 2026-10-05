// Central store for user-facing UI strings. Strings resolve through
// chrome.i18n.getMessage(), which selects the message keyed to the browser's UI
// language from the catalog in _locales/<locale>/messages.json (en, ko, ja, zh_CN,
// zh_TW; en is the default_locale fallback). No page-detection
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

// Shown (fail-loud) when the PDF exporter cannot read its font faces out of the
// extension package, so pdfmake would otherwise fall back to a face with no Hangul or
// CJK coverage and render a whole page of tofu boxes (AGENTS.md #4).
export const PDF_FONT_LOAD_FAILED_MESSAGE = m('pdfFontLoadFailedMessage');

// How many of the undrawable characters the warning names. Enough to recognise what
// went missing (a kana run, an emoji), short enough that the alert stays readable when
// a whole Japanese conversation contributed hundreds of them.
const MISSING_GLYPH_SAMPLE_LIMIT = 10;

/**
 * Shown after a PDF export that succeeded but contains characters no embedded face can
 * draw — they are in the file as empty boxes. Non-blocking: the PDF is still worth
 * having, and staying silent about it is the AGENTS.md #4 violation.
 *
 * `unsupported` is the deduplicated set collectUnsupportedChars returns, so the count
 * is of DISTINCT characters — the catalogs say so, because a conversation with 800
 * kana drawn from 20 distinct ones would otherwise read as barely affected.
 *
 * Lives here, not at either call site: the single-export alert and the bulk-panel
 * summary must not drift into sampling differently for the same file.
 */
export function pdfMissingGlyphsMessage(unsupported: readonly string[]): string {
  return m('pdfMissingGlyphsMessage', [
    String(unsupported.length),
    unsupported.slice(0, MISSING_GLYPH_SAMPLE_LIMIT).join(' '),
  ]);
}

// Shown (fail-loud) when extraction returns a conversation with no messages, so
// there is nothing worth downloading (AGENTS.md #4).
export const EXPORT_EMPTY_MESSAGE = m('exportEmptyMessage');

// --- Bulk export (select several sidebar conversations and download them all) ---

// The toolbar button that opens the bulk-export selection panel.
export const DOWNLOAD_BULK_LABEL = m('downloadBulkLabel');
export const DOWNLOAD_BULK_ARIA_LABEL = m('downloadBulkAriaLabel');

// The trigger mounted on a Project home page that opens the same selection panel,
// pre-filled with that project's conversations.
export const DOWNLOAD_PROJECT_BULK_LABEL = m('downloadProjectBulkLabel');
export const DOWNLOAD_PROJECT_BULK_ARIA_LABEL = m('downloadProjectBulkAriaLabel');

// The same trigger mounted on a provider's full-history page (Claude's `/recents`). The
// visible label is shared with the project trigger ("Download all"); only the accessible
// name differs, because "this project" is wrong for the whole history.
export const DOWNLOAD_RECENTS_BULK_ARIA_LABEL = m('downloadRecentsBulkAriaLabel');

// Selection-panel chrome.
export const BULK_PANEL_TITLE = m('bulkPanelTitle');
export const BULK_PANEL_FORMAT_LABEL = m('bulkPanelFormatLabel');
export const BULK_PANEL_SELECT_ALL = m('bulkPanelSelectAll');
export const BULK_PANEL_CANCEL = m('bulkPanelCancel');
export const BULK_PANEL_CLOSE = m('bulkPanelClose');

// The "Load more" button that pulls not-yet-rendered conversations out of the
// virtualized source list into the checklist (busy/done states while it runs / after
// everything is loaded).
export const BULK_PANEL_LOAD_MORE = m('bulkPanelLoadMore');
export const BULK_PANEL_LOAD_MORE_BUSY = m('bulkPanelLoadMoreBusy');
export const BULK_PANEL_LOAD_MORE_DONE = m('bulkPanelLoadMoreDone');

/** Progress line while "Load more" walks the list, e.g. "Loading conversations… 340 so far". */
export function bulkLoadMoreProgressMessage(loaded: number): string {
  return m('bulkLoadMoreProgressMessage', [String(loaded)]);
}

/**
 * Shown in place of the progress line when "Load more" stopped while the adapter's page-size
 * parity check still expected another page — the list may be short, so the panel says so
 * instead of silently presenting it as complete (AGENTS.md #4).
 */
export function bulkLoadMoreIncompleteMessage(loaded: number): string {
  return m('bulkLoadMoreIncompleteMessage', [String(loaded)]);
}

/**
 * The incomplete warning when the walk named a rate limit as the cause (ChatGPT's load-error
 * row after a 429): a rerun right away stops at the same point, so it asks for a wait.
 */
export function bulkLoadMoreRateLimitedMessage(loaded: number): string {
  return m('bulkLoadMoreRateLimitedMessage', [String(loaded)]);
}

// Shown when the history sidebar lists no conversations to choose from (fail-loud:
// the panel opens but makes clear there is nothing to export rather than showing an
// empty, actionless list).
export const BULK_EMPTY_MESSAGE = m('bulkEmptyMessage');

/** Visible fail-loud message when the provider cannot enumerate the list for the panel. */
export function bulkListErrorMessage(error: string): string {
  return m('bulkListErrorMessage', [error]);
}

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

// --- First-run coach mark (points at the browser toolbar's Extensions button) ---

// Heading, explanation and dismiss-button label of the once-only card, plus its accessible
// name (the card is a non-modal role="dialog").
export const COACH_MARK_TITLE = m('coachMarkTitle');
export const COACH_MARK_BODY = m('coachMarkBody');
export const COACH_MARK_CLOSE_LABEL = m('coachMarkCloseLabel');
export const COACH_MARK_ARIA_LABEL = m('coachMarkAriaLabel');

// --- Options page (choose which toolbar icons to show) ---

// Document title (browser tab) and the visible page heading of the options page.
export const OPTIONS_TITLE = m('optionsTitle');
export const OPTIONS_HEADING = m('optionsHeading');

// Section labels for the format checklist and the bulk-icon toggle.
export const OPTIONS_FORMATS_LABEL = m('optionsFormatsLabel');
export const OPTIONS_BULK_LABEL = m('optionsBulkLabel');

// Transient confirmation shown after a change is saved.
export const OPTIONS_SAVED_NOTE = m('optionsSavedNote');

// Shown (fail-loud) when persisting a change to chrome.storage.sync fails, so the user is
// not told a setting was saved when it was not.
export const OPTIONS_SAVE_FAILED_NOTE = m('optionsSaveFailedNote');

// Shown when the user tries to uncheck the last remaining format (at least one is required).
export const OPTIONS_MIN_FORMAT_NOTE = m('optionsMinFormatNote');

// --- Extraction errors (thrown as ExtractionError by the adapters, shown via alert) ---
//
// Every fail-loud message an adapter throws resolves here so it reaches all five
// catalogs (AGENTS.md Language Policy). A message whose English wording branches on a
// count (turn vs N turns) is split into two keys: chrome.i18n has no plural forms, and a
// single `$count$` key would force "1 turns" in English.

// Shared across providers (identical wording on ChatGPT, Claude and Gemini).
export const ERR_TURNS_UNREADABLE = m('errTurnsUnreadable');
export const ERR_SCROLL_TO_START_TIMED_OUT = m('errScrollToStartTimedOut');

// ChatGPT.
export const ERR_CHATGPT_CODE_BLOCK_INCOMPLETE = m('errChatgptCodeBlockIncomplete');
export const ERR_CHATGPT_SIDEBAR_LINK_MISSING = m('errChatgptSidebarLinkMissing');
export const ERR_CHATGPT_OPEN_TIMED_OUT = m('errChatgptOpenTimedOut');
export const ERR_CHATGPT_PROJECT_LINK_MISSING = m('errChatgptProjectLinkMissing');
export const ERR_CHATGPT_PROJECT_OPEN_TIMED_OUT = m('errChatgptProjectOpenTimedOut');
export const ERR_CHATGPT_PROJECT_BACK_LINK_MISSING = m('errChatgptProjectBackLinkMissing');
export const ERR_CHATGPT_PROJECT_HOME_TIMED_OUT = m('errChatgptProjectHomeTimedOut');
export const ERR_CHATGPT_NO_MESSAGES = m('errChatgptNoMessages');
export const ERR_CHATGPT_LOAD_OLDER_TIMED_OUT = m('errChatgptLoadOlderTimedOut');
export const ERR_CHATGPT_LOAD_OLDER_STALLED = m('errChatgptLoadOlderStalled');
export const ERR_CHATGPT_TURN_ID_MISSING = m('errChatgptTurnIdMissing');
export const ERR_CHATGPT_SIDEBAR_SCROLL_TIMED_OUT = m('errChatgptSidebarScrollTimedOut');
export const ERR_CHATGPT_PROJECT_LIST_SCROLL_TIMED_OUT = m('errChatgptProjectListScrollTimedOut');

// Gemini.
export const ERR_GEMINI_SIDEBAR_MISSING = m('errGeminiSidebarMissing');
export const ERR_GEMINI_SIDEBAR_COLLAPSED = m('errGeminiSidebarCollapsed');
export const ERR_GEMINI_SIDEBAR_LINKS_UNREADABLE = m('errGeminiSidebarLinksUnreadable');
export const ERR_GEMINI_OPEN_URL_MALFORMED = m('errGeminiOpenUrlMalformed');
export const ERR_GEMINI_OPEN_LINK_MISSING = m('errGeminiOpenLinkMissing');
export const ERR_GEMINI_OPEN_TIMED_OUT = m('errGeminiOpenTimedOut');
export const ERR_GEMINI_NO_MESSAGES = m('errGeminiNoMessages');
export const ERR_GEMINI_MESSAGE_LIST_MISSING = m('errGeminiMessageListMissing');
export const ERR_GEMINI_MESSAGE_LIST_UNSCROLLABLE = m('errGeminiMessageListUnscrollable');
export const ERR_GEMINI_STILL_GENERATING = m('errGeminiStillGenerating');
export const ERR_GEMINI_RESPONSE_UNREADABLE = m('errGeminiResponseUnreadable');

/** Gemini unloaded some already-loaded exchanges while they were being read. */
export function errGeminiExchangesDroppedMessage(loaded: number, expected: number): string {
  return m('errGeminiExchangesDropped', [String(loaded), String(expected)]);
}

// Claude.
export const ERR_CLAUDE_ARTIFACT_AND_ATTACHMENT = m('errClaudeArtifactAndAttachment');
export const ERR_CLAUDE_SIDEBAR_MISSING = m('errClaudeSidebarMissing');
export const ERR_CLAUDE_PROJECT_LIST_MISSING = m('errClaudeProjectListMissing');
export const ERR_CLAUDE_PROJECT_ROW_MALFORMED = m('errClaudeProjectRowMalformed');
export const ERR_CLAUDE_OPEN_URL_MALFORMED = m('errClaudeOpenUrlMalformed');
export const ERR_CLAUDE_OPEN_LINK_MISSING = m('errClaudeOpenLinkMissing');
export const ERR_CLAUDE_OPEN_TIMED_OUT = m('errClaudeOpenTimedOut');
export const ERR_CLAUDE_PROJECT_OPEN_URL_MALFORMED = m('errClaudeProjectOpenUrlMalformed');
export const ERR_CLAUDE_PROJECT_OPEN_LINK_MISSING = m('errClaudeProjectOpenLinkMissing');
export const ERR_CLAUDE_PROJECT_OPEN_TIMED_OUT = m('errClaudeProjectOpenTimedOut');
export const ERR_CLAUDE_PROJECT_HOME_URL_MISSING = m('errClaudeProjectHomeUrlMissing');
export const ERR_CLAUDE_PROJECT_HOME_HISTORY_UNAVAILABLE = m('errClaudeProjectHomeHistoryUnavailable');
export const ERR_CLAUDE_PROJECT_HOME_TIMED_OUT = m('errClaudeProjectHomeTimedOut');
// Console-only: thrown solely by the post-batch return hook, which the bulk driver only logs.
export const ERR_CLAUDE_PROJECT_HOME_MISMATCH = m('errClaudeProjectHomeMismatch');
export const ERR_CLAUDE_RECENTS_LIST_MISSING = m('errClaudeRecentsListMissing');
export const ERR_CLAUDE_RECENTS_ROW_MALFORMED = m('errClaudeRecentsRowMalformed');
export const ERR_CLAUDE_RECENTS_LINKS_INCOMPLETE = m('errClaudeRecentsLinksIncomplete');
export const ERR_CLAUDE_RECENTS_LINK_MISSING = m('errClaudeRecentsLinkMissing');
export const ERR_CLAUDE_RECENTS_HISTORY_UNAVAILABLE = m('errClaudeRecentsHistoryUnavailable');
export const ERR_CLAUDE_RECENTS_RETURN_TIMED_OUT = m('errClaudeRecentsReturnTimedOut');
// Console-only: thrown solely by the post-batch return hook, which the bulk driver only logs.
export const ERR_CLAUDE_NOT_RECENTS_PAGE = m('errClaudeNotRecentsPage');
export const ERR_CLAUDE_NO_MESSAGES = m('errClaudeNoMessages');
export const ERR_CLAUDE_STREAMING_SETTLE_TIMED_OUT = m('errClaudeStreamingSettleTimedOut');
export const ERR_CLAUDE_COMPLETION_MARKER_MISSING = m('errClaudeCompletionMarkerMissing');
export const ERR_CLAUDE_TURN_INDEX_MISSING = m('errClaudeTurnIndexMissing');
export const ERR_CLAUDE_ARTIFACT_ROOT_UNRECOGNIZED = m('errClaudeArtifactRootUnrecognized');
export const ERR_CLAUDE_ARTIFACT_ORPHAN = m('errClaudeArtifactOrphan');
export const ERR_CLAUDE_ARTIFACT_METADATA_UNREADABLE = m('errClaudeArtifactMetadataUnreadable');

/**
 * A Claude navigation surface rendered conversation links but none was readable. One key
 * per surface: the surface name is part of the sentence, not a translatable placeholder.
 */
export function errClaudeLinksUnreadableMessage(surface: 'sidebar' | 'project' | 'recents'): string {
  switch (surface) {
    case 'sidebar':
      return m('errClaudeSidebarLinksUnreadable');
    case 'project':
      return m('errClaudeProjectLinksUnreadable');
    case 'recents':
      return m('errClaudeRecentsLinksUnreadable');
  }
}

/** The first `count` turns never loaded, even after scrolling to the top. */
export function errClaudeFirstTurnsNeverLoadedMessage(count: number): string {
  return count === 1 ? m('errClaudeFirstTurnNeverLoaded') : m('errClaudeFirstTurnsNeverLoaded', [String(count)]);
}

/** Turns between two read positions are missing. Indices arrive zero-based; users count from one. */
export function errClaudeTurnGapMessage(fromIndex: number, toIndex: number): string {
  return m('errClaudeTurnGap', [String(fromIndex + 1), String(toIndex + 1)]);
}

/** The last `count` turns never loaded; Claude declared `declared` messages, `read` were read. */
export function errClaudeLastTurnsNeverLoadedMessage(count: number, declared: number, read: number): string {
  return count === 1
    ? m('errClaudeLastTurnNeverLoaded', [String(declared), String(read)])
    : m('errClaudeLastTurnsNeverLoaded', [String(count), String(declared), String(read)]);
}

/** Rendered rows at `rowIndices` yielded no readable message. Indices arrive zero-based; users count from one. */
export function errClaudeUnreadableRowsMessage(rowIndices: readonly number[]): string {
  const list = rowIndices.map((index) => index + 1).join(', ');
  return rowIndices.length === 1 ? m('errClaudeUnreadableRow', [list]) : m('errClaudeUnreadableRows', [list]);
}
