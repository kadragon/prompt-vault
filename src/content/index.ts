import { isConversationPage } from './page';
import { removeButtons, setToolbarSettings, syncButtons } from './mount';
import { loadSettings, subscribeSettings, type ToolbarSettings } from '../settings/store';

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
// Last URL seen, to detect ChatGPT's history.pushState navigations (sidebar clicks),
// which change the URL without a popstate. On a URL change we restart the grace and
// drop the previous page's buttons so they re-mount cleanly into the new header —
// otherwise convTicks stays past the grace and the brief empty-header gap during the
// re-render spuriously triggers (and then sticks) the bottom-right overlay.
let lastHref = location.href;

function tick(): void {
  if (location.href !== lastHref) {
    lastHref = location.href;
    convTicks = 0;
    removeButtons(document);
  }
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
  // `tick` already detects the URL change and restarts the grace; popstate just makes
  // back/forward feel instant instead of waiting for the next poll.
  window.addEventListener('popstate', tick);
  setInterval(tick, NAV_POLL_MS);
}

/**
 * Apply loaded/changed toolbar settings: swap the cached value the toolbar renders from,
 * then re-mount so the change takes effect immediately (removeButtons + a fresh tick).
 */
function applySettings(settings: ToolbarSettings): void {
  setToolbarSettings(settings);
  removeButtons(document);
  tick();
}

watchNavigation();
tick();

// Load the user's toolbar settings and re-mount once they arrive (the first tick above
// draws the all-on default until then). Then keep the toolbar in sync with live changes
// from the options page. Failure to read storage is non-fatal — the default toolbar stays.
loadSettings().then(applySettings).catch(() => undefined);
subscribeSettings(applySettings);
