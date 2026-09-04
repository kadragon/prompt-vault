import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import {
  COACH_MARK_ID,
  armCoachMark,
  isCoachMarkVisible,
  maybeShowCoachMark,
  removeCoachMark,
  showCoachMark,
  syncCoachMark,
} from '../../src/content/coach-mark';
import { CONTAINER_ID, createButtons, removeButtons } from '../../src/content/mount';
import { isCoachMarkDismissed } from '../../src/settings/onboarding';
import { COACH_MARK_ARIA_LABEL, COACH_MARK_BODY, COACH_MARK_CLOSE_LABEL } from '../../src/strings';

const STORAGE_KEY = 'coachMarkDismissed';

// Same helper shape as test/settings/store.test.ts, pointed at the `local` area.
function installStorageMock(seed: Record<string, unknown> = {}): Record<string, unknown> {
  const store: Record<string, unknown> = { ...seed };
  const local = {
    get(key: string): Promise<Record<string, unknown>> {
      return Promise.resolve(key in store ? { [key]: store[key] } : {});
    },
    set(items: Record<string, unknown>): Promise<void> {
      Object.assign(store, items);
      return Promise.resolve();
    },
  };
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  g.chrome = { ...g.chrome, storage: { local } };
  return store;
}

function bareWindow(): Window {
  const window = new Window();
  window.document.write('<body><main id="page">page content</main></body>');
  return window;
}

function docOf(window: Window): Document {
  return window.document as unknown as Document;
}

/** Let the fire-and-forget persist settle before asserting on the store. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

let store: Record<string, unknown>;

beforeEach(() => {
  store = installStorageMock();
});

describe('showCoachMark', () => {
  it('mounts exactly one card carrying the pin instructions', () => {
    const window = bareWindow();
    const doc = docOf(window);
    showCoachMark(doc);

    const cards = doc.querySelectorAll(`#${COACH_MARK_ID}`);
    expect(cards).toHaveLength(1);
    expect(isCoachMarkVisible(doc)).toBe(true);
    expect(cards[0].textContent).toContain(COACH_MARK_BODY);
    // The copy must name the Extensions button and the pin action without claiming the
    // extension pins itself.
    expect(COACH_MARK_BODY.toLowerCase()).toContain('puzzle-piece');
    expect(COACH_MARK_BODY.toLowerCase()).toContain('pin');
  });

  it('is a non-modal dialog: labelled, focusable, focused, with no aria-modal and no backdrop', () => {
    const window = bareWindow();
    const doc = docOf(window);
    const card = showCoachMark(doc);

    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-label')).toBe(COACH_MARK_ARIA_LABEL);
    expect(card.hasAttribute('aria-modal')).toBe(false);
    expect(card.tabIndex).toBe(-1);
    expect(doc.activeElement).toBe(card);

    // Non-blocking chrome: the card itself is the only node added to <body>, it is anchored in
    // the top-right corner rather than covering the viewport, and nothing else sits over the page.
    expect(doc.body.children).toHaveLength(2); // <main> + the card
    expect(card.style.position).toBe('fixed');
    expect(card.style.top).toBe('12px');
    expect(card.style.right).toBe('12px');
    expect(card.style.zIndex).toBe('2147483647');
    expect(card.style.getPropertyValue('inset')).toBe('');
    expect(card.style.width).not.toContain('100');
    expect(card.style.background).not.toContain('rgba');
  });

  it('does not steal focus from a control the user is already using', () => {
    const window = bareWindow();
    const doc = docOf(window);
    const input = doc.createElement('input');
    doc.body.appendChild(input);
    input.focus();

    const card = showCoachMark(doc);

    // The card is mounted by a poll tick, not a user gesture, so it must leave focus alone.
    expect(doc.activeElement).toBe(input);
    expect(doc.activeElement).not.toBe(card);
  });

  it('uses an id distinct from the toolbar container, so removeButtons cannot wipe it', () => {
    const window = bareWindow();
    const doc = docOf(window);
    expect(COACH_MARK_ID).not.toBe(CONTAINER_ID);

    doc.body.appendChild(createButtons(doc, 'overlay'));
    showCoachMark(doc);
    removeButtons(doc);

    expect(doc.getElementById(CONTAINER_ID)).toBeNull();
    expect(isCoachMarkVisible(doc)).toBe(true);
  });
});

describe('dismiss paths', () => {
  it('removes the card and persists the flag on close-button click', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    const card = showCoachMark(doc);

    const button = card.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe(COACH_MARK_CLOSE_LABEL);
    button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event);
    await flush();

    expect(isCoachMarkVisible(doc)).toBe(false);
    expect(store[STORAGE_KEY]).toBe(true);
    await expect(isCoachMarkDismissed()).resolves.toBe(true);
  });

  it('removes the card and persists the flag on Escape', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    showCoachMark(doc);

    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event);
    await flush();

    expect(isCoachMarkVisible(doc)).toBe(false);
    expect(store[STORAGE_KEY]).toBe(true);
  });

  it('dismisses on Escape pressed while focus sits in a page input', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    const input = doc.createElement('input');
    doc.getElementById('page')?.appendChild(input);
    input.focus();
    showCoachMark(doc);

    // Dispatched on the focused input, not on `document`: this only reaches the handler
    // because it is bound on the document and the event bubbles. A card-bound listener
    // would never see it, so the user could not dismiss without first clicking the card.
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
    await flush();

    expect(isCoachMarkVisible(doc)).toBe(false);
    expect(store[STORAGE_KEY]).toBe(true);
  });

  it('survives a press that begins inside the card and is released outside it', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    const card = showCoachMark(doc);

    card.dispatchEvent(new window.Event('pointerdown', { bubbles: true }) as unknown as Event);
    doc.getElementById('page')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event);
    await flush();

    expect(isCoachMarkVisible(doc)).toBe(true);
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it('removes the card and persists the flag on a pointer press outside it', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    showCoachMark(doc);

    const page = doc.getElementById('page');
    page?.dispatchEvent(new window.Event('pointerdown', { bubbles: true }) as unknown as Event);
    page?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event);
    await flush();

    expect(isCoachMarkVisible(doc)).toBe(false);
    expect(store[STORAGE_KEY]).toBe(true);
  });

  it('survives a click whose press began before the card was shown (poll-mount race)', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    showCoachMark(doc);

    // The user pressed the page BEFORE the poll tick mounted the card, so only the trailing
    // `click` reaches our listeners. Dismissing on it would kill a card nobody has read.
    doc.getElementById('page')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event);
    await flush();

    expect(isCoachMarkVisible(doc)).toBe(true);
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it('ignores a click inside the card', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    const card = showCoachMark(doc);

    card.querySelector('p')?.dispatchEvent(new window.Event('pointerdown', { bubbles: true }) as unknown as Event);
    card.querySelector('p')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event);
    await flush();

    expect(isCoachMarkVisible(doc)).toBe(true);
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it('unbinds both document listeners on dismissal', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    const removeSpy = vi.spyOn(doc, 'removeEventListener');
    showCoachMark(doc);

    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event);
    await flush();

    const removedTypes = removeSpy.mock.calls.map(([type]) => type);
    expect(removedTypes).toContain('keydown');
    expect(removedTypes).toContain('pointerdown');
    removeSpy.mockRestore();
  });

  it('unbinds the listeners when the card is removed without being dismissed', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    showCoachMark(doc);

    // A silent teardown is not a dismissal: the user never saw the card, so a later Escape must
    // not persist the flag on their behalf and burn the one showing they are owed.
    removeCoachMark(doc);
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event);
    await flush();

    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it('leaves a stale card\u2019s listeners unable to dismiss a later card', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    showCoachMark(doc);
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event);
    await flush();

    // One Escape must dismiss exactly the card that is up — if the first card's listeners were
    // still bound they would run against a detached node and (with them) a second persist.
    const second = showCoachMark(doc);
    expect(second.isConnected).toBe(true);
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event);
    await flush();
    expect(isCoachMarkVisible(doc)).toBe(false);
  });
});

// The gate below is the REAL one from src/content/coach-mark.ts (the same function the bootstrap
// calls on every poll tick); only the storage read that arms it is re-stated, exactly as
// src/content/index.ts does it.
async function armFromStorage(): Promise<void> {
  if (await isCoachMarkDismissed()) return;
  armCoachMark();
}

describe('the once-only gate across an SPA route change', () => {
  it('shows once after the toolbar mounts, and never again after dismissal + re-mount', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    await armFromStorage();

    // No toolbar yet: nothing renders, even though the latch is armed.
    maybeShowCoachMark(doc);
    expect(isCoachMarkVisible(doc)).toBe(false);

    // Toolbar mounts -> exactly one card, and repeated ticks do not add another.
    doc.body.appendChild(createButtons(doc, 'overlay'));
    maybeShowCoachMark(doc);
    maybeShowCoachMark(doc);
    expect(doc.querySelectorAll(`#${COACH_MARK_ID}`)).toHaveLength(1);

    // The latch must be cleared by the show itself, not merely by the card being present: with
    // the card gone from the DOM (without a dismissal) a further tick still renders nothing.
    removeCoachMark(doc);
    maybeShowCoachMark(doc);
    expect(isCoachMarkVisible(doc)).toBe(false);
  });

  it('stays silent on a fresh page load once the flag is persisted', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    await armFromStorage();
    doc.body.appendChild(createButtons(doc, 'overlay'));
    maybeShowCoachMark(doc);

    // Dismiss, then simulate an SPA href change: the bootstrap drops the toolbar and re-mounts.
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event);
    await flush();
    removeButtons(doc);
    doc.body.appendChild(createButtons(doc, 'overlay'));
    maybeShowCoachMark(doc);
    expect(isCoachMarkVisible(doc)).toBe(false);

    // And a whole new page load (the arming read run again) sees the persisted flag.
    await armFromStorage();
    maybeShowCoachMark(doc);
    expect(isCoachMarkVisible(doc)).toBe(false);
  });
});

describe('syncCoachMark (one poll tick)', () => {
  it('tears the card down when the toolbar it explains is gone', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    await armFromStorage();
    doc.body.appendChild(createButtons(doc, 'overlay'));
    syncCoachMark(doc);
    expect(isCoachMarkVisible(doc)).toBe(true);

    // What #76 hit: the toolbar goes (route change, non-conversation page, an expanded report
    // opening over it) while the `position: fixed` card stays on top of whatever replaced it.
    removeButtons(doc);
    syncCoachMark(doc);
    expect(isCoachMarkVisible(doc)).toBe(false);
    // Not a dismissal: the user may never have read the card, so nothing is persisted.
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it('unbinds the torn-down card, so a later outside press cannot persist a dismissal', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    await armFromStorage();
    doc.body.appendChild(createButtons(doc, 'overlay'));
    syncCoachMark(doc);
    removeButtons(doc);
    syncCoachMark(doc);

    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }) as unknown as Event);
    await flush();
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it('is a no-op on a page that never mounted a toolbar', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    await armFromStorage();
    syncCoachMark(doc);
    expect(isCoachMarkVisible(doc)).toBe(false);
  });

  it('does not resurrect the card when the toolbar re-mounts', async () => {
    const window = bareWindow();
    const doc = docOf(window);
    await armFromStorage();
    doc.body.appendChild(createButtons(doc, 'overlay'));
    syncCoachMark(doc);
    removeButtons(doc);
    syncCoachMark(doc);

    // The latch was spent by the first show; a re-mounted toolbar must not buy a second card.
    doc.body.appendChild(createButtons(doc, 'overlay'));
    syncCoachMark(doc);
    expect(isCoachMarkVisible(doc)).toBe(false);
  });
});
