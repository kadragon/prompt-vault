// First-run coach mark: a small, non-modal card in the top-right corner of the page telling the
// user where the extension's toolbar icon is and how to pin it. Shown at most once per browser
// profile — the once-only latch is the gate at the bottom of this file, and the persisted flag
// lives in src/settings/onboarding.ts.
//
// Non-modal on purpose: no backdrop, no `aria-modal`, and nothing that intercepts pointer events
// outside the card, so the host page stays fully usable while it is up. That is the difference
// from src/content/bulk-panel.ts, whose shell is a real modal.

import { COACH_MARK_ARIA_LABEL, COACH_MARK_BODY, COACH_MARK_CLOSE_LABEL, COACH_MARK_TITLE } from '../strings';
import { markCoachMarkDismissed } from '../settings/onboarding';
import { CONTAINER_ID } from './mount';

// Stable id on the card, deliberately distinct from mount.ts's `CONTAINER_ID`: `removeButtons()`
// wipes that id on every SPA href change, which would silently delete the coach mark mid-read.
export const COACH_MARK_ID = 'prompt-vault-coach-mark';

/** Whether the coach mark is currently mounted in `doc`. */
export function isCoachMarkVisible(doc: Document): boolean {
  return doc.getElementById(COACH_MARK_ID) !== null;
}

// Unbinds the mounted card's document listeners, if a card is up. Held at module scope so
// `removeCoachMark` can tear a card down completely: listeners left bound to a detached card would
// keep answering Escape and outside presses, persisting the dismissal for a card nobody saw.
let unbindActiveCard: (() => void) | null = null;

/** Remove the coach mark if mounted (without persisting anything). */
export function removeCoachMark(doc: Document): void {
  unbindActiveCard?.();
  unbindActiveCard = null;
  doc.getElementById(COACH_MARK_ID)?.remove();
}

/**
 * Mount the coach mark into `doc.body` and return it. Dismissing it — via the close button,
 * Escape, or a pointer press anywhere outside the card — removes the node, unbinds the document
 * listeners, and persists the dismissal flag so it never comes back.
 */
export function showCoachMark(doc: Document): HTMLDivElement {
  const card = doc.createElement('div');
  card.id = COACH_MARK_ID;
  card.setAttribute('role', 'dialog');
  // No `aria-modal`: this card does not trap focus and the page behind it stays interactive.
  card.setAttribute('aria-label', COACH_MARK_ARIA_LABEL);
  // Focusable so focus can be moved into the card on show, making Escape work immediately.
  card.tabIndex = -1;
  Object.assign(card.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '2147483647',
    boxSizing: 'border-box',
    width: 'min(320px, 88vw)',
    padding: '14px 16px',
    background: '#ffffff',
    color: '#111111',
    border: '1px solid #e5e5e5',
    borderRadius: '12px',
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.25)',
    fontFamily: 'inherit',
    fontSize: '13px',
    lineHeight: '1.5',
    textAlign: 'left',
  });

  // Caret pointing up at the browser toolbar (which sits above the page, top-right). Decorative
  // only, so it is hidden from assistive tech; the card's text carries the meaning.
  const caret = doc.createElement('div');
  caret.textContent = '▲';
  caret.setAttribute('aria-hidden', 'true');
  Object.assign(caret.style, {
    position: 'absolute',
    top: '-13px',
    right: '18px',
    fontSize: '16px',
    lineHeight: '1',
    color: '#ffffff',
    textShadow: '0 -1px 0 #e5e5e5',
  });
  card.appendChild(caret);

  const title = doc.createElement('h2');
  title.textContent = COACH_MARK_TITLE;
  Object.assign(title.style, { margin: '0 0 6px', fontSize: '14px', fontWeight: '600' });
  card.appendChild(title);

  const body = doc.createElement('p');
  body.textContent = COACH_MARK_BODY;
  Object.assign(body.style, { margin: '0 0 12px' });
  card.appendChild(body);

  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = COACH_MARK_CLOSE_LABEL;
  closeButton.setAttribute('aria-label', COACH_MARK_CLOSE_LABEL);
  Object.assign(closeButton.style, {
    display: 'block',
    marginLeft: 'auto',
    padding: '6px 14px',
    fontSize: '13px',
    fontFamily: 'inherit',
    color: '#ffffff',
    background: '#10a37f',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  });
  card.appendChild(closeButton);

  // Escape is bound on the document, not the card: focus may move back into the page (this card
  // does not trap it), and Escape should still dismiss.
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismiss();
  };
  // Outside press. Bound on the document (bubble phase) rather than via a backdrop element,
  // because a backdrop would swallow the page's own clicks.
  //
  // `pointerdown` and not `click`, deliberately: the card is mounted by a poll tick rather than by
  // a user gesture, so a press ALREADY in flight when it appeared would deliver its trailing
  // `click` into a freshly bound handler and dismiss a card the user never saw. A pointerdown can
  // only be seen if it started after the listener was bound, which is exactly the press we want.
  //
  // `contains`, not `instanceof Node`: the card lives in the host page's document, and a global
  // `Node` binding is not guaranteed in every realm the content script is bundled for.
  const onPointerDown = (e: Event): void => {
    const target = e.target as Node | null;
    if (target !== null && card.contains(target)) return;
    dismiss();
  };

  const unbind = (): void => {
    doc.removeEventListener('keydown', onKeydown);
    doc.removeEventListener('pointerdown', onPointerDown);
  };

  let dismissed = false;
  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    unbind();
    unbindActiveCard = null;
    card.remove();
    // Fire-and-forget: `markCoachMarkDismissed` swallows its own failures, so the card is never
    // left on screen waiting for storage.
    void markCoachMarkDismissed();
  };

  closeButton.addEventListener('click', () => dismiss());
  doc.addEventListener('keydown', onKeydown);
  doc.addEventListener('pointerdown', onPointerDown);
  unbindActiveCard = unbind;

  doc.body.appendChild(card);
  // Take focus ONLY when nothing in the page holds it. The card is mounted by a poll tick rather
  // than by a user gesture, so stealing focus could yank the caret out of the composer mid-typing.
  // Escape still works from anywhere, because its listener is bound on the document.
  if (doc.activeElement === null || doc.activeElement === doc.body) card.focus();
  return card;
}

// --- Once-only gate -------------------------------------------------------------------------
//
// Lives here, beside the card, so the bootstrap (src/content/index.ts) and the tests exercise the
// SAME gate rather than a hand-copied one. The bootstrap owns only the storage read and the poll.

// Starts disarmed so nothing can render before the stored flag has been read — and so a storage
// failure (which `isCoachMarkDismissed` resolves as dismissed) simply leaves it disarmed.
let coachMarkArmed = false;

/** Arm the gate: the next `maybeShowCoachMark` with a mounted toolbar shows the card. */
export function armCoachMark(): void {
  coachMarkArmed = true;
}

/**
 * Disarm the gate without showing anything. Used when another tab persists the dismissal while
 * this tab is still armed — the user has answered the tip, so this tab must not raise it later.
 */
export function disarmCoachMark(): void {
  coachMarkArmed = false;
}

/**
 * Show the coach mark if it is armed, the extension's toolbar has actually mounted, and no card
 * is up. Gating on the toolbar container — not on any page or provider signal — keeps this
 * provider-agnostic and means the card only appears when there is real extension UI to explain.
 * The latch is cleared BEFORE showing, so no number of SPA route changes or re-mounts can
 * produce a second card.
 */
export function maybeShowCoachMark(doc: Document): void {
  if (!coachMarkArmed) return;
  if (!doc.getElementById(CONTAINER_ID)) return;
  if (isCoachMarkVisible(doc)) return;
  coachMarkArmed = false;
  showCoachMark(doc);
}
