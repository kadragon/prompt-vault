import { armCoachMark, disarmCoachMark, removeCoachMark, syncCoachMark } from './coach-mark';
import { NAV_POLL_MS, createBootstrap } from './bootstrap';
import { loadSettings, subscribeSettings } from '../settings/store';
import { isCoachMarkDismissed, subscribeCoachMarkDismissed } from '../settings/onboarding';

const { tick, applySettings } = createBootstrap({ doc: document, getHref: () => location.href });

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

watchNavigation();
tick();

// Keep the toolbar in sync with the user's stored settings. Subscribe FIRST so a change made
// while the initial read is still in flight is never missed; a `liveUpdate` latch then keeps
// the (possibly stale) initial load from clobbering a newer live change that already applied.
// The first tick above draws the all-on default until settings arrive; a storage read failure
// is non-fatal — the default toolbar stays.
let liveUpdateApplied = false;
subscribeSettings((settings) => {
  liveUpdateApplied = true;
  applySettings(settings);
});
loadSettings()
  .then((settings) => {
    if (!liveUpdateApplied) applySettings(settings);
  })
  .catch(() => undefined);

// Arm the first-run coach mark if it has never been dismissed; the next tick with a mounted
// toolbar shows it. Independent of the settings read above so neither failure affects the other.
isCoachMarkDismissed()
  .then((dismissed) => {
    if (dismissed) return;
    armCoachMark();
    syncCoachMark(document);
  })
  .catch(() => undefined);

// Every supported tab runs its own copy of this script and reads the flag independently, so two
// tabs opened before either card is dismissed each show one. Dismissing in either tab persists the
// flag, which is what this listener picks up: drop this tab's card and disarm it, so the user
// answers the tip once rather than once per open tab.
subscribeCoachMarkDismissed(() => {
  disarmCoachMark();
  removeCoachMark(document);
});
