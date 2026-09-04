import { isConversationPage, isProjectPage, isRecentsPage } from './page';
import { removeButtons, setToolbarSettings, syncButtons } from './mount';
import {
  armCoachMark,
  disarmCoachMark,
  removeCoachMark,
  resetCoachMarkAbsence,
  syncCoachMark,
} from './coach-mark';
import { loadSettings, subscribeSettings, type ToolbarSettings } from '../settings/store';
import { isCoachMarkDismissed, subscribeCoachMarkDismissed } from '../settings/onboarding';

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

/**
 * Drop the toolbar because the bootstrap itself decided to, and restart the coach mark's teardown
 * grace with it. Every such gap is a re-mount rather than a departure, so the grace must start
 * over — a normal gap already spends all but one tick of it, and an extra out-of-cadence tick
 * would tear the card down mid-read for good (the once-only latch is spent by then).
 *
 * Both call sites go through here so that invariant cannot drift; a `removeButtons` the PAGE
 * caused (a re-render over our node) is deliberately not routed here — that absence is real, and
 * counting it is how the card leaves a page that no longer has a toolbar.
 *
 * Not covered by a test: the bootstrap has no test file (the grace itself is pinned in
 * test/content/coach-mark.test.ts, which drives `resetCoachMarkAbsence` directly). Keep the two
 * call sites here rather than inlining the pair.
 */
function dropToolbar(): void {
  removeButtons(document);
  resetCoachMarkAbsence();
}

function tick(): void {
  if (location.href !== lastHref) {
    lastHref = location.href;
    convTicks = 0;
    dropToolbar();
  }
  // Conversation pages, project home pages and the full-history page all get a mounted
  // control, and all want the overlay-fallback grace (these SPAs render their mount points
  // asynchronously after a route change), so the grace counter advances on any of them.
  const mountable =
    isConversationPage(location.href) || isProjectPage(location.href) || isRecentsPage(location.href);
  convTicks = mountable ? convTicks + 1 : 0;
  syncButtons(document, location.href, { allowOverlayFallback: convTicks >= MOUNT_GRACE_TICKS });
  syncCoachMark(document);
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
 * then re-mount so the change takes effect immediately (removeButtons + a fresh tick). The
 * re-mount is skipped when the value did not actually change, so the common load path (stored
 * settings == the all-on default already showing) causes no visible flash.
 */
function applySettings(settings: ToolbarSettings): void {
  if (!setToolbarSettings(settings)) return;
  dropToolbar();
  tick();
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
