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
   * A file-attachment tile inside a user turn (e.g. an uploaded/pasted-as-file `.txt`).
   * ChatGPT renders it as a `role="group"` element whose `aria-label` is the file name;
   * the tile carries no readable text node, so such a turn extracts empty unless the name
   * is pulled from here. Used only to describe an otherwise text-free turn so it is not
   * dropped (AGENTS.md #4). Verified against the live page (2026-07-22); re-verify if
   * attachment turns start exporting empty.
   */
  attachmentTile: '[role="group"][aria-label]',

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
   * The expanded deep-research report view. ChatGPT renders it as a cross-origin sandbox
   * iframe (`*.web-sandbox.oaiusercontent.com`) that covers the page and carries its own
   * export control, while the conversation header — and with it `headerActions` — is gone
   * from the top document. Matched only to suppress the fallback overlay, which would
   * otherwise float over that view's own chrome; nothing is ever injected into the frame
   * (it is another origin). Verified against the live page (2026-08-26).
   */
  expandedReportFrame: 'iframe[src*="web-sandbox.oaiusercontent.com"]',

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
   * EVERY conversation row inside `sidebarHistory`, top-level and project/GPT-scoped alike
   * — deliberately wider than `sidebarConversationLink`, which takes only the `/c/…` rows
   * the bulk list exports. This is the row count the server pages in, so it is the only
   * count that reveals the page size: measured 2026-07-29 on a 1042-conversation account,
   * `#history` appended a fixed **28 rows** per page across 36 consecutive pages while the
   * `/c/`-only increment varied 15-27, because the split between the two kinds varies per
   * page (`852 /c/ + 190 /g/…/c/ = 1042`, every anchor in `#history`). Used by the
   * parity oracle in `loadMoreConversations`, never for extraction. Verified against the
   * live page (2026-07-29); re-verify if the load-more walk starts warning on healthy lists.
   */
  sidebarConversationRow: 'a[href*="/c/"]',

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
