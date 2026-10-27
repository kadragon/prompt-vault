// Keyboard focus handling shared by the modal panels (src/content/bulk-panel.ts,
// src/content/share-panel.ts). A modal owns the page (docs/conventions.md → Injected page
// UI): Tab must not walk out of it onto the host page behind the backdrop — where Enter on
// a toolbar button would start an export under the open modal — and closing it must put
// focus back where the user was.

const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Keep Tab / Shift+Tab inside `dialog`: past the last focusable control it wraps to the
 * first, and back. Call from the modal's document-level keydown handler.
 */
export function trapTab(dialog: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = items[0];
  const last = items.at(-1);
  const active = dialog.ownerDocument.activeElement;
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const outside = !active || !dialog.contains(active);
  if (event.shiftKey && (outside || active === first || active === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (outside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Return focus to the control that opened a modal. Skipped when it has left the page — an
 * SPA re-render can replace the toolbar while the modal is open — so focus is never sent
 * to a detached node.
 */
export function restoreFocus(opener: Element | null): void {
  if (opener?.isConnected && typeof (opener as HTMLElement).focus === 'function') {
    (opener as HTMLElement).focus();
  }
}
