import { DOWNLOAD_BUTTON_LABEL } from '../strings';
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
  // Stub: the real Markdown/PDF export is wired up in later tickets.
  button.addEventListener('click', () => {
    console.info('[prompt-vault] Download stub — export not yet implemented.');
  });
  return button;
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
