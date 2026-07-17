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
   * A native control inside `toolbarMount` that the export buttons should be inserted
   * immediately before (e.g. the provider's Share button), so they sit to its left
   * without replacing it. The content layer inserts ahead of whichever direct child
   * of the mount contains this element, falling back to the front of the bar when it
   * is absent. Provider-owned so the shared content layer carries no site-specific
   * selector. Optional — omit to always mount at the front of the bar.
   */
  toolbarAnchor?(root?: ParentNode): Element | null;
}
