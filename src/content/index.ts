import { pickAdapter } from '../adapters';
import { ExtractionError } from '../core/errors';
import { markdownFilename, toMarkdown } from '../export/markdown';
import {
  DOWNLOAD_MD_LABEL,
  DOWNLOAD_PDF_LABEL,
  EXPORT_FAILED_MESSAGE,
  EXPORT_NO_ADAPTER_MESSAGE,
} from '../strings';
import { isConversationPage } from './page';

// Stable id on the button container so it is mounted at most once and can be
// located for removal.
const CONTAINER_ID = 'prompt-vault-download-buttons';

// How often to re-check the URL for SPA navigation (see watchNavigation).
const NAV_POLL_MS = 500;

// Export formats offered by the toolbar, in display order.
type Format = 'md' | 'pdf';
const FORMATS: ReadonlyArray<{ format: Format; label: string }> = [
  { format: 'md', label: DOWNLOAD_MD_LABEL },
  { format: 'pdf', label: DOWNLOAD_PDF_LABEL },
];

function createButtons(): HTMLDivElement {
  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  Object.assign(container.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '2147483647',
    display: 'flex',
    gap: '6px',
  });
  for (const { format, label } of FORMATS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
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
      void runExport(container, format);
    });
    container.appendChild(button);
  }
  return container;
}

/**
 * Extract the current conversation and download it in `format`, entirely
 * locally. Fail-loud (AGENTS.md #4): any extraction/export problem surfaces a
 * visible alert and no file is written — never a silent or empty download.
 * Disables both buttons while running so a second click cannot start a
 * concurrent export.
 */
async function runExport(container: HTMLDivElement, format: Format): Promise<void> {
  const buttons = container.querySelectorAll('button');
  if ([...buttons].some((b) => b.disabled)) return;
  buttons.forEach((b) => (b.disabled = true));
  try {
    const adapter = pickAdapter(location.href);
    if (!adapter) {
      alert(EXPORT_NO_ADAPTER_MESSAGE);
      return;
    }
    const conversation = await adapter.extract();
    const now = new Date();
    if (format === 'md') {
      downloadTextFile(markdownFilename(conversation, now), toMarkdown(conversation), 'text/markdown');
    } else {
      // pdfmake + the embedded CJK font are heavy; load them only on demand so an
      // ordinary page visit never pays for them (@crxjs code-splits this import).
      const { downloadPdf } = await import('./pdf-download');
      await downloadPdf(conversation, now);
    }
  } catch (error) {
    // ExtractionError carries a user-actionable message; anything else is
    // unexpected and gets the generic fallback.
    alert(error instanceof ExtractionError ? error.message : EXPORT_FAILED_MESSAGE);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
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
 * Mount the buttons on a conversation page, remove them elsewhere. Idempotent:
 * safe to call repeatedly (initial load, every SPA navigation).
 */
function syncButton(): void {
  const existing = document.getElementById(CONTAINER_ID);
  if (isConversationPage(location.href)) {
    if (!existing) {
      document.body.appendChild(createButtons());
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
