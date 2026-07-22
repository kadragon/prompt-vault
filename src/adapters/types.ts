import type { Conversation } from '../core/conversation';
import type { SidebarConversation } from '../core/sidebar';

// The contract every provider implements (docs/architecture.md). A new provider is
// a new directory under src/adapters/{provider}/ exporting one of these, plus a
// registry entry and a manifest host — zero changes to core or exporters.
export interface ConversationAdapter {
  /** Provider slug stamped onto the extracted Conversation, e.g. `chatgpt`. */
  readonly provider: string;

  /** True when this adapter handles the given page URL. */
  matches(url: string): boolean;

  /**
   * Scrape the current page into the normalized model. Defaults to the live
   * `document`; tests pass a parsed fixture root instead. Throws `ExtractionError`
   * (fail-loud) when no usable messages are found.
   */
  extract(root?: ParentNode): Promise<Conversation>;

  /**
   * The provider's native header action bar (e.g. the pill holding the Share
   * button) where the export buttons should be injected so they blend with the page
   * chrome instead of floating over it. Returns null when that bar is not in the DOM
   * — the SPA is still rendering, or the markup changed — and the content script
   * then falls back to a non-overlapping overlay. Defaults to the live `document`;
   * tests pass a parsed fixture root. Optional: a provider without a known toolbar
   * omits it and always uses the overlay.
   */
  toolbarMount?(root?: ParentNode): Element | null;

  /**
   * Provider-owned CSS class string applied to each export button when it is mounted
   * into the native header bar (see `toolbarMount`), so the buttons wear the
   * provider's own chrome (matching its native controls, light/dark, hover). Kept in
   * the adapter so the shared content layer carries no provider-specific styling.
   * Optional — omit to leave the native buttons unstyled but functional.
   */
  readonly toolbarButtonClass?: string;

  /**
   * A native control inside `toolbarMount` that the export buttons should be inserted
   * immediately before (e.g. the provider's Share button), so they sit to its left
   * without replacing it. The content layer inserts ahead of whichever direct child
   * of the mount contains this element, falling back to the front of the bar when it
   * is absent. Provider-owned so the shared content layer carries no site-specific
   * selector. Optional — omit to always mount at the front of the bar.
   */
  toolbarAnchor?(root?: ParentNode): Element | null;

  /**
   * Enumerate the conversations listed in the provider's history sidebar into the
   * lightweight `SidebarConversation` model, in display order. Pure DOM read — no
   * messages are scraped here (that is `extract`'s job, after `openConversation`
   * navigates to each). Returns `[]` when the sidebar is not in the DOM. Powers the
   * bulk-export selection UI. Defaults to the live `document`; tests pass a parsed
   * fixture root. Optional: a provider without a known sidebar omits it, and the bulk
   * feature is simply unavailable there.
   */
  listConversations?(root?: ParentNode): SidebarConversation[];

  /**
   * Client-side navigate to `url` (one of `listConversations`' entries) WITHOUT a
   * full page reload — so the content script and its in-flight bulk run survive —
   * and resolve once the target conversation has rendered. Throws `ExtractionError`
   * (fail-loud, AGENTS.md #4) when the conversation cannot be reached within the
   * timeout, so the bulk driver records the miss instead of extracting the wrong
   * (still-showing) chat. Inherently live-DOM; `opts` exposes the polling knobs so
   * the wait is tunable. Optional and paired with `listConversations` — a provider
   * that lists must also open.
   */
  openConversation?(url: string, opts?: OpenConversationOptions): Promise<void>;

  /**
   * Load every not-yet-rendered conversation in the provider's virtualized history
   * sidebar (scroll it until the rendered list stops growing), so a following
   * `listConversations` re-scan sees the full list. Powers the bulk panel's "Load
   * more" button. Best-effort — resolves when the sidebar is absent; fail-loud
   * (`ExtractionError`, AGENTS.md #4) only on a runaway that never settles. Inherently
   * live-DOM; `opts` exposes the scroll knobs so the loop is unit-testable. Optional
   * and paired with `listConversations` — a provider whose sidebar is not virtualized
   * omits it and the panel simply shows no "Load more" button.
   */
  loadMoreConversations?(root?: ParentNode, opts?: LoadMoreOptions): Promise<void>;

  // --- Project bulk-download track (parallel to the history track above) ---
  // A "Project" groups conversations under their own home page. These members power
  // bulk-downloading every conversation in one project; a provider without projects
  // omits them and the project trigger simply never mounts.

  /** True when `url` is one of this provider's Project home pages. */
  matchesProject?(url: string): boolean;

  /**
   * Enumerate the conversations shown on a Project home page into the lightweight
   * `SidebarConversation` model, in display order (keyed by the stable conversation
   * id). Pure DOM read — no messages are scraped (that is `extract`'s job, after
   * `openProjectConversation` navigates). Returns `[]` when the list is absent.
   * Defaults to the live `document`; tests pass a parsed fixture root.
   */
  listProjectConversations?(root?: ParentNode): SidebarConversation[];

  /**
   * Like `openConversation`, but for a project conversation: the anchor may live in
   * the project home page's list or in the persistent project sidebar expando shown
   * once a conversation is open, so it is located by conversation id across whichever
   * is currently in the DOM. Fail-loud on miss/timeout (AGENTS.md #4).
   */
  openProjectConversation?(url: string, opts?: OpenConversationOptions): Promise<void>;

  /**
   * Like `loadMoreConversations`, but for a Project home page's virtualized conversation
   * list. Best-effort when the list is absent; fail-loud on a runaway that never settles.
   * Optional and paired with `listProjectConversations`.
   */
  loadMoreProjectConversations?(root?: ParentNode, opts?: LoadMoreOptions): Promise<void>;

  /**
   * Client-side navigate back to the project home page `homeUrl` (where a bulk run
   * started), so the user is returned to the project they exported from — matched by
   * project id, not the first available home link. Best-effort — resolves at once when
   * already on that project's home; rejects only when the navigation cannot be made (the
   * bulk caller swallows that, as it does not affect the batch result).
   */
  openProjectHome?(homeUrl: string, opts?: OpenConversationOptions): Promise<void>;

  /**
   * The element on a Project home page to mount the bulk-download trigger into (e.g.
   * the section holding the conversation list), or null when it is not in the DOM yet
   * — the content layer then falls back to a non-overlapping overlay. Defaults to the
   * live `document`; tests pass a parsed fixture root.
   */
  projectToolbarMount?(root?: ParentNode): Element | null;

  /**
   * Provider-owned CSS class string applied to the project bulk-download trigger when it
   * mounts natively (see `projectToolbarMount`), so it wears the provider's own labeled
   * button chrome (matching its native controls, light/dark, hover). Distinct from
   * `toolbarButtonClass` (the conversation header's icon-only square). Kept in the
   * adapter so the shared content layer carries no provider-specific styling. Optional —
   * omit to leave the native trigger unstyled but functional.
   */
  readonly projectToolbarButtonClass?: string;
}

/**
 * Scroll knobs for the `loadMore*` virtualized-list loop, so the wait is unit-testable
 * without real timers/DOM. Structurally matches the ChatGPT adapter's `AutoScrollOptions`.
 */
export interface LoadMoreOptions {
  /** Milliseconds to wait after each scroll pin before re-counting. */
  stepDelayMs?: number;
  /** Rounds with no new items before the list is judged fully loaded. */
  stableRounds?: number;
  /** Absolute step cap; exceeding it while items still appear fails loud. */
  maxSteps?: number;
}

/** Polling knobs for `openConversation`'s wait-for-render loop. */
export interface OpenConversationOptions {
  /** Milliseconds between readiness polls. */
  pollMs?: number;
  /** Give up (fail-loud) after this many milliseconds without the conversation rendering. */
  timeoutMs?: number;
}
