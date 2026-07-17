// A lightweight listing entry for one conversation in a provider's history sidebar.
// Distinct from the full `Conversation` model (src/core/conversation.ts): this is
// only what the selection UI needs to show a checklist and later open each chat —
// no messages are scraped until the bulk driver navigates to the conversation and
// runs the adapter's `extract`. Provider-agnostic, so the bulk UI carries no
// site-specific knowledge (docs/architecture.md).

export interface SidebarConversation {
  /** Provider-assigned conversation id (the URL path id), stable per chat. */
  id: string;
  /** Human title shown in the sidebar (the checklist label). */
  title: string;
  /** Absolute URL the bulk driver navigates to in order to open this conversation. */
  url: string;
}
