// Every ChatGPT DOM selector lives here, exactly once (docs/conventions.md). When
// ChatGPT's markup changes, this is the one file to update. Verified against live
// captures in test/fixtures/chatgpt/ (2026-07-17). ChatGPT's DOM is unstable —
// re-verify against the live page and refresh fixtures when extraction regresses.

export const selectors = {
  /** A single message turn; the author-role attribute distinguishes user/assistant. */
  message: '[data-message-author-role]',
  /** Attribute holding the role value (`user` | `assistant` | `system`). */
  authorRoleAttr: 'data-message-author-role',
  /** Attribute holding the provider message id. */
  messageIdAttr: 'data-message-id',

  /** Raw user text lives in a pre-wrap block inside the user message node. */
  userText: '.whitespace-pre-wrap',
  /** Rendered assistant HTML lives in the `.markdown` prose container. */
  assistantMarkdown: '.markdown',

  /**
   * Scroll viewport that virtualizes the message list. ChatGPT lazy-renders older
   * turns as you scroll up, so auto-scroll targets this element. Best-effort: if
   * absent, extraction falls back to whatever is already in the DOM.
   */
  scrollContainer: 'main [class*="overflow-y"]',
} as const;
