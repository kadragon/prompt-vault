import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { createBootstrap, MOUNT_GRACE_TICKS } from '../../src/content/bootstrap';
import {
  COACH_MARK_TEARDOWN_GRACE_TICKS,
  armCoachMark,
  disarmCoachMark,
  isCoachMarkVisible,
  resetCoachMarkAbsence,
} from '../../src/content/coach-mark';
import { CONTAINER_ID, setToolbarSettings } from '../../src/content/mount';
import { DEFAULT_SETTINGS, type ToolbarSettings } from '../../src/settings/store';

// Two conversation URLs and two pages with no toolbar of their own. The bootstrap only reads the
// href through `getHref`, so these need no matching DOM.
const CONV_URL = 'https://chatgpt.com/c/abc-123';
const HOME_URL = 'https://chatgpt.com/';
const OTHER_HOME_URL = 'https://chatgpt.com/#settings';

// Everything visible except the bulk icon — a value `setToolbarSettings` reports as changed
// against the all-on default, so `applySettings` takes its re-mount branch.
const CHANGED_SETTINGS: ToolbarSettings = { ...DEFAULT_SETTINGS, bulk: false };

/**
 * A page with no header bar and no project section, so nothing the adapters can mount into: the
 * toolbar arrives only via the overlay fallback, after `MOUNT_GRACE_TICKS` ticks on a mountable
 * route, and leaving that route removes it. That is what lets a test open a toolbar gap of a
 * chosen length without touching the mount logic.
 */
function bareDoc(): Document {
  const window = new Window();
  window.document.write('<body><main id="page">page content</main></body>');
  return window.document as unknown as Document;
}

/** Drive the loop `count` times, the way the 500 ms poll would. */
function ticks(tick: () => void, count: number): void {
  for (let i = 0; i < count; i += 1) tick();
}

/**
 * A bootstrap whose href the test controls, already ticked far enough for the overlay toolbar to
 * mount and the armed coach mark to show. Returns the seams the cases drive.
 */
function mountedWithCoachMark(): {
  doc: Document;
  tick: () => void;
  applySettings: (settings: ToolbarSettings) => void;
  setHref: (href: string) => void;
} {
  const doc = bareDoc();
  let href = CONV_URL;
  const { tick, applySettings } = createBootstrap({ doc, getHref: () => href });
  armCoachMark();
  ticks(tick, MOUNT_GRACE_TICKS);
  expect(doc.getElementById(CONTAINER_ID)).not.toBeNull();
  expect(isCoachMarkVisible(doc)).toBe(true);
  return { doc, tick, applySettings, setHref: (next: string) => (href = next) };
}

beforeEach(() => {
  // Both are module state in src/content/coach-mark.ts: without the reset a case inherits the
  // previous one's absence count and armed latch.
  resetCoachMarkAbsence();
  disarmCoachMark();
});

afterEach(() => {
  // `setToolbarSettings` caches module-side too; leave it on the all-on default the next case
  // (and test/content/mount.test.ts) assumes.
  setToolbarSettings(DEFAULT_SETTINGS);
});

describe('createBootstrap', () => {
  it('is inert on import: constructing one neither mounts nor reads the page', () => {
    const doc = bareDoc();
    createBootstrap({ doc, getHref: () => CONV_URL });
    expect(doc.getElementById(CONTAINER_ID)).toBeNull();
  });

  it('restarts the coach mark teardown grace on an SPA href change', () => {
    const { doc, tick, setHref } = mountedWithCoachMark();

    // Leave the mountable route: the toolbar goes and the teardown grace starts counting.
    setHref(HOME_URL);
    ticks(tick, COACH_MARK_TEARDOWN_GRACE_TICKS - 1);
    expect(doc.getElementById(CONTAINER_ID)).toBeNull();
    expect(isCoachMarkVisible(doc)).toBe(true);

    // A second href change one tick short of the teardown. Without the reset in `dropToolbar`
    // this tick is the grace's last and the card is deleted mid-read.
    setHref(OTHER_HOME_URL);
    tick();
    expect(isCoachMarkVisible(doc)).toBe(true);

    // And the restarted grace is a full one, not a single borrowed tick.
    ticks(tick, COACH_MARK_TEARDOWN_GRACE_TICKS - 2);
    expect(isCoachMarkVisible(doc)).toBe(true);
  });

  it('restarts the coach mark teardown grace when changed settings re-mount the toolbar', () => {
    const { doc, tick, applySettings, setHref } = mountedWithCoachMark();

    setHref(HOME_URL);
    ticks(tick, COACH_MARK_TEARDOWN_GRACE_TICKS - 1);
    expect(isCoachMarkVisible(doc)).toBe(true);

    // `applySettings` drops the toolbar and ticks once itself — the same one-tick-short position
    // as the href case, reached through the other `dropToolbar` call site.
    applySettings(CHANGED_SETTINGS);
    expect(isCoachMarkVisible(doc)).toBe(true);

    ticks(tick, COACH_MARK_TEARDOWN_GRACE_TICKS - 2);
    expect(isCoachMarkVisible(doc)).toBe(true);
  });

  it('leaves the mounted toolbar node alone when the settings did not actually change', () => {
    const { doc, applySettings } = mountedWithCoachMark();
    const mounted = doc.getElementById(CONTAINER_ID);

    // The common load path: stored settings equal the all-on default already showing. Without the
    // early return this tears the container out and builds a fresh one — a visible flash of the
    // toolbar on every page load. Node identity is what separates that from doing nothing; the
    // re-mount is same-tick, so `getElementById` alone cannot tell the two apart.
    applySettings({ ...DEFAULT_SETTINGS, formats: { ...DEFAULT_SETTINGS.formats } });
    expect(doc.getElementById(CONTAINER_ID)).toBe(mounted);
  });

  it('still tears the coach mark down once the toolbar is gone for the whole grace', () => {
    const { doc, tick, setHref } = mountedWithCoachMark();

    // The other half of `dropToolbar`'s asymmetry: the restart above must not become a blanket
    // "never count absence", or the card outlives the toolbar it explains.
    setHref(HOME_URL);
    ticks(tick, COACH_MARK_TEARDOWN_GRACE_TICKS);
    expect(isCoachMarkVisible(doc)).toBe(false);
  });
});
