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
   * turns as you scroll up, so auto-scroll targets this element. It is an ancestor
   * of `<main>` (verified against the captured fixtures — the messages all live
   * inside it), marked with a stable `data-scroll-root` attribute. Best-effort: if
   * absent, extraction falls back to whatever is already in the DOM.
   */
  scrollContainer: '[data-scroll-root]',

  /**
   * The header action bar holding ChatGPT's native controls (Share, conversation
   * options) — a translucent-surface pill in the top-right of a conversation. The
   * export buttons are injected here so they sit inline with Share instead of a
   * fixed overlay covering it. Verified against the captured fixtures (2026-07-17);
   * re-verify against the live page if the buttons stop mounting.
   */
  headerActions: '#conversation-header-actions',

  /**
   * ChatGPT's native Share button inside the header action bar. It is the anchor the
   * export buttons are placed to the left of (beside it, not replacing it). Matched
   * by its stable `data-testid`; verified against the captured fixtures (2026-07-17).
   */
  shareButton: '[data-testid="share-chat-button"]',
} as const;
