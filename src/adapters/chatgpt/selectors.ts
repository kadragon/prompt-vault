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

  /**
   * The history-list container in the left sidebar (`#history`), holding the
   * `<a href="/c/…">` links for past conversations. Scoping the conversation-link
   * query to this element cleanly excludes project/GPT chats (which live under
   * `/g/…/c/…` in separate sections) and the composer. Verified against the live
   * page (2026-07-17); re-verify if the bulk selection list comes up empty.
   */
  sidebarHistory: '#history',

  /**
   * A single past-conversation link inside `sidebarHistory`. `href` is `/c/<id>`
   * (the active chat's link may carry a `?messageId=…` query, deduped by path id) and
   * the full, untruncated title lives in the link's `aria-label`. Verified against the
   * live page (2026-07-17).
   */
  sidebarConversationLink: 'a[href^="/c/"]',

  /**
   * A conversation link on a Project home page (`/g/g-p-<id>/project`) or in the
   * persistent project sidebar expando shown while a project conversation is open.
   * `href` is `/g/g-p-<id>[-slug]/c/<convId>` — the slug varies by context, so match
   * on the `/g/g-p-` prefix plus the `/c/` segment and key by the stable `convId`.
   * On the project home page these live in a `<main>` `<ol>` of
   * `<li class="group/project-item">`; only the project home page is scraped for the
   * bulk list, so no extra scoping is needed. Verified against the live page
   * (2026-07-18); re-verify if the project bulk list comes up empty.
   */
  projectConversationLink: 'a[href*="/g/g-p-"][href*="/c/"]',

  /**
   * The conversation title inside a `projectConversationLink` on a project home page —
   * a `text-sm font-medium` block holding the human title (the sibling block is a
   * message-body preview snippet, also `text-sm` but NOT `font-medium`, so both classes
   * are required to avoid picking the snippet). Best-effort: extraction falls back to
   * the link's text when this is absent. Verified against the live page (2026-07-18).
   */
  projectConversationTitle: '.text-sm.font-medium',

  /**
   * The link back to a project's home page shown while a project conversation is open
   * (`href` ends `/project`). Used to return the user to the project after a bulk run.
   * Verified against the live page (2026-07-18).
   */
  projectBackLink: 'a[href$="/project"]',
} as const;
