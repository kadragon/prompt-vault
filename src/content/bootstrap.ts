import { isConversationPage, isProjectPage, isRecentsPage } from './page';
import { removeButtons, setToolbarSettings, syncButtons } from './mount';
import { resetCoachMarkAbsence, syncCoachMark } from './coach-mark';
import type { ToolbarSettings } from '../settings/store';

// How often to re-check the page for SPA navigation and header re-renders (see
// watchNavigation in src/content/index.ts).
export const NAV_POLL_MS = 500;

// Ticks on a conversation page before we give up on the native header bar and fall
// back to a non-overlapping overlay. ChatGPT renders the header asynchronously after
// a route change, so wait a few polls (≈3s) before assuming the bar is truly absent
// rather than just not-yet-rendered.
export const MOUNT_GRACE_TICKS = 6;

export interface BootstrapOptions {
  /** The page document the toolbar and the coach mark mount into. */
  doc: Document;
  /** Reads the current URL. A function, not a value: the SPA changes it under us. */
  getHref: () => string;
}

export interface Bootstrap {
  /** One poll tick: detect SPA navigation, then re-sync the toolbar and the coach mark. */
  tick: () => void;
  /** Apply loaded/changed toolbar settings, re-mounting only on a real change. */
  applySettings: (settings: ToolbarSettings) => void;
}

/**
 * Build the navigation-poll loop over an injected document and URL source. The per-page counters
 * live in this closure rather than as module state so importing the module starts nothing and
 * runs nothing — src/content/index.ts owns every side effect (the interval, the listener, the
 * storage subscriptions), which is what lets test/content/bootstrap.test.ts drive the loop.
 */
export function createBootstrap({ doc, getHref }: BootstrapOptions): Bootstrap {
  // Consecutive ticks spent on a conversation page; drives the overlay-fallback grace.
  let convTicks = 0;
  // Last URL seen, to detect ChatGPT's history.pushState navigations (sidebar clicks),
  // which change the URL without a popstate. On a URL change we restart the grace and
  // drop the previous page's buttons so they re-mount cleanly into the new header —
  // otherwise convTicks stays past the grace and the brief empty-header gap during the
  // re-render spuriously triggers (and then sticks) the bottom-right overlay.
  let lastHref = getHref();

  /**
   * Drop the toolbar because the bootstrap itself decided to, and restart the coach mark's
   * teardown grace with it. Every such gap is a re-mount rather than a departure, so the grace
   * must start over — a normal gap already spends all but one tick of it, and an extra
   * out-of-cadence tick would tear the card down mid-read for good (the once-only latch is spent
   * by then).
   *
   * Both call sites go through here so that invariant cannot drift; a `removeButtons` the PAGE
   * caused (a re-render over our node) is deliberately not routed here — that absence is real,
   * and counting it is how the card leaves a page that no longer has a toolbar.
   *
   * Both sides of that asymmetry are pinned in test/content/bootstrap.test.ts.
   */
  function dropToolbar(): void {
    removeButtons(doc);
    resetCoachMarkAbsence();
  }

  function tick(): void {
    const href = getHref();
    if (href !== lastHref) {
      lastHref = href;
      convTicks = 0;
      dropToolbar();
    }
    // Conversation pages, project home pages and the full-history page all get a mounted
    // control, and all want the overlay-fallback grace (these SPAs render their mount points
    // asynchronously after a route change), so the grace counter advances on any of them.
    const mountable = isConversationPage(href) || isProjectPage(href) || isRecentsPage(href);
    convTicks = mountable ? convTicks + 1 : 0;
    syncButtons(doc, href, { allowOverlayFallback: convTicks >= MOUNT_GRACE_TICKS });
    syncCoachMark(doc);
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

  return { tick, applySettings };
}
