import { pickAdapter } from '../adapters';
import { ExtractionError } from '../core/errors';
import { markdownFilename, toMarkdown } from '../export/markdown';
import {
  DOWNLOAD_BUTTON_LABEL,
  EXPORT_FAILED_MESSAGE,
  EXPORT_NO_ADAPTER_MESSAGE,
} from '../strings';
import { isConversationPage } from './page';

// Stable id so the button is mounted at most once and can be located for removal.
const BUTTON_ID = 'prompt-vault-download-button';

// How often to re-check the URL for SPA navigation (see watchNavigation).
const NAV_POLL_MS = 500;

function createButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = DOWNLOAD_BUTTON_LABEL;
  Object.assign(button.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '2147483647',
    padding: '6px 12px',
    fontSize: '13px',
    fontFamily: 'inherit',
    color: '#ffffff',
    background: '#10a37f',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
  });
  button.addEventListener('click', () => {
    void runExport(button);
  });
  return button;
}

/**
 * Extract the current conversation and download it as Markdown, entirely
 * locally. Fail-loud (AGENTS.md #4): any extraction/export problem surfaces a
 * visible alert and no file is written — never a silent or empty download.
 * Disables the button while running so a second click cannot start a concurrent
 * export.
 */
async function runExport(button: HTMLButtonElement): Promise<void> {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const adapter = pickAdapter(location.href);
    if (!adapter) {
      alert(EXPORT_NO_ADAPTER_MESSAGE);
      return;
    }
    const conversation = await adapter.extract();
    const markdown = toMarkdown(conversation);
    const filename = markdownFilename(conversation, new Date());
    downloadTextFile(filename, markdown, 'text/markdown');
  } catch (error) {
    // ExtractionError carries a user-actionable message; anything else is
    // unexpected and gets the generic fallback.
    alert(error instanceof ExtractionError ? error.message : EXPORT_FAILED_MESSAGE);
  } finally {
    button.disabled = false;
  }
}

/**
 * Trigger a local file download from an in-memory string via an object URL and a
 * transient `<a download>`. No network request (Golden Principle #1). Revocation
 * is deferred to a later task: the browser dispatches the download asynchronously
 * after `click()`, so revoking the object URL in the same tick can cancel an
 * in-flight or large download.
 */
function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Mount the button on a conversation page, remove it elsewhere. Idempotent:
 * safe to call repeatedly (initial load, every SPA navigation).
 */
function syncButton(): void {
  const existing = document.getElementById(BUTTON_ID);
  if (isConversationPage(location.href)) {
    if (!existing) {
      document.body.appendChild(createButton());
    }
  } else if (existing) {
    existing.remove();
  }
}

/**
 * ChatGPT is a client-routed SPA: the content script loads once and the URL
 * changes without a reload. A content script runs in the isolated world and
 * cannot observe the page's own history.pushState calls (those happen in the
 * main world), but `location` always reflects the current URL across worlds.
 * So poll it and re-sync on change; `popstate` gives instant back/forward.
 */
function watchNavigation(): void {
  let lastHref = location.href;
  const check = (): void => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      syncButton();
    }
  };
  window.addEventListener('popstate', check);
  setInterval(check, NAV_POLL_MS);
}

watchNavigation();
syncButton();
