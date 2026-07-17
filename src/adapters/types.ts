import type { Conversation } from '../core/conversation';

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
   * CSS selectors for native header controls the export buttons supersede and that
   * should be hidden while they are mounted (e.g. the provider's own Share button,
   * made redundant by the injected download controls). The content layer hides them
   * with a single injected stylesheet, so hiding survives the SPA re-rendering the
   * header. Provider-owned so the shared content layer carries no site-specific
   * selectors. Optional — omit to hide nothing.
   */
  readonly toolbarHiddenSelectors?: readonly string[];
}
