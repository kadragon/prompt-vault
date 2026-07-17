import { DOWNLOAD_BUTTON_LABEL } from '../strings';
import { NAV_EVENT } from './nav-event';
import { isConversationPage } from './page';

// Stable id so the button is mounted at most once and can be located for removal.
const BUTTON_ID = 'prompt-vault-download-button';

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

// The MAIN-world nav-hook (nav-hook.ts) re-broadcasts the app router's history
// changes as NAV_EVENT on the shared window; re-sync the button on each.
window.addEventListener(NAV_EVENT, syncButton);
syncButton();
