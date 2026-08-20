// A lightweight listing entry for one conversation in a provider's history sidebar.
// Distinct from the full `Conversation` model (src/core/conversation.ts): this is
// only what the selection UI needs to show a checklist and later open each chat —
// no messages are scraped until the bulk driver navigates to the conversation and
// runs the adapter's `extract`. Provider-agnostic, so the bulk UI carries no
// site-specific knowledge (docs/architecture.md).

import { ownerDocument } from './dom';

export interface SidebarConversation {
  /** Provider-assigned conversation id (the URL path id), stable per chat. */
  id: string;
  /** Human title shown in the sidebar (the checklist label). */
  title: string;
  /** Absolute URL the bulk driver navigates to in order to open this conversation. */
  url: string;
}

// --- Scroll-walk mechanics ---------------------------------------------------
//
// The pure machinery every provider's conversation-list loader runs on, extracted
// because all three adapters carried byte-identical copies. Deliberately only the
// *mechanics*: the settle loop itself stays in each adapter, because the three
// differ on policy (terminal behavior at the step cap, the `lastCount` seed, when
// `onIncomplete` fires, and whether the page-parity verdict is two- or three-valued)
// and those differences are decisions with their own tests, not duplication.

/** Resolve after `ms` milliseconds. The dwell between scroll rounds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Nearest vertically-scrollable ancestor of `el` (including `el` itself), falling back
 * to `el`. Deliberately generic rather than a hardcoded selector: a sidebar's scroll
 * wrapper is not a stable, verified selector and provider markup shifts (AGENTS.md #5).
 *
 * Never null — an unscrollable subtree resolves to `el`, which callers then reject via
 * their own `scrollHeight <= clientHeight` guard rather than a null check.
 */
export function findScrollableAncestor(el: Element): HTMLElement {
  const view = ownerDocument(el)?.defaultView ?? null;
  let current: Element | null = el;
  while (current) {
    const node = current as HTMLElement;
    if (node.scrollHeight > node.clientHeight) {
      // `getComputedStyle` can return null for a disconnected element in some engines,
      // so read `overflowY` optionally rather than crashing the whole load.
      const overflowY = view?.getComputedStyle?.(node)?.overflowY;
      if (!overflowY || overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node;
    }
    current = current.parentElement;
  }
  return el as HTMLElement;
}

/** Whether `el` reports usable scroll geometry — false for a stub node in a parsed fixture. */
export function hasScrollMetrics(el: Element): el is HTMLElement {
  const node = el as HTMLElement;
  return Number.isFinite(node.scrollHeight) && Number.isFinite(node.clientHeight);
}

/**
 * Whether a scroll round failed to move `container` past `previousTop` — i.e. the browser
 * is clamping `scrollTop` because there is nothing left to scroll.
 *
 * Deliberately a position *delta* rather than the `scrollTop + clientHeight >= scrollHeight`
 * arithmetic used for a message viewport: `findScrollableAncestor` resolves whichever ancestor
 * scrolls, whose geometry need not agree with the list's own.
 *
 * The zero-height arm is not redundant. A background tab (or a collapsed port) reports
 * `clientHeight === 0`, so the advance below rounds to a 1px creep, `scrollTop <= previousTop`
 * never holds, and the walk spins to its step cap before reporting anything. A port that
 * cannot scroll at all is at its end by definition.
 */
export function isPortClamped(container: HTMLElement, previousTop: number): boolean {
  return container.clientHeight === 0 || container.scrollTop <= previousTop;
}

/**
 * Scroll `container` down by `fraction` of its own viewport, clamped to the bottom.
 *
 * A fraction just under 1 leaves a deliberate overlap so consecutive windows abut with no
 * gap. Degrades gracefully for a lazy-load list whose height grows as chunks load: each step
 * nudges toward the receding bottom, pulling the next chunk. The `max(1, ...)` floor keeps a
 * zero-height port moving rather than deadlocking on a 0px advance.
 */
export function advanceScrollPort(container: HTMLElement, fraction: number): void {
  const { scrollTop, clientHeight, scrollHeight } = container;
  const advance = Math.max(1, Math.floor(clientHeight * fraction));
  container.scrollTop = Math.min(scrollTop + advance, scrollHeight);
}
