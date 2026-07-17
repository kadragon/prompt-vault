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
}
