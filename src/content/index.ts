import { isConversationPage } from './page';
import { syncButtons } from './mount';

// How often to re-check the page for SPA navigation and header re-renders (see
// watchNavigation).
const NAV_POLL_MS = 500;

// Ticks on a conversation page before we give up on the native header bar and fall
// back to a non-overlapping overlay. ChatGPT renders the header asynchronously after
// a route change, so wait a few polls (≈3s) before assuming the bar is truly absent
// rather than just not-yet-rendered.
const MOUNT_GRACE_TICKS = 6;

// Consecutive ticks spent on a conversation page; drives the overlay-fallback grace.
let convTicks = 0;

function tick(): void {
  convTicks = isConversationPage(location.href) ? convTicks + 1 : 0;
  syncButtons(document, location.href, { allowOverlayFallback: convTicks >= MOUNT_GRACE_TICKS });
}

/**
 * ChatGPT is a client-routed SPA: the content script loads once and the URL changes
 * without a reload. A content script runs in the isolated world and cannot observe
 * the page's own history.pushState calls (those happen in the main world), but
 * `location` always reflects the current URL across worlds. So poll it and re-sync;
 * the poll also re-injects the buttons when React re-renders the header and drops our
 * node. `popstate` gives instant back/forward.
 */
function watchNavigation(): void {
  window.addEventListener('popstate', () => {
    convTicks = 0;
    tick();
  });
  setInterval(tick, NAV_POLL_MS);
}

watchNavigation();
tick();
