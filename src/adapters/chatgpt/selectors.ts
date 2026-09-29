// Every ChatGPT DOM selector lives here, exactly once (docs/conventions.md). When
// ChatGPT's markup changes, this is the one file to update. ChatGPT's DOM is unstable —
// re-verify against the live page and refresh fixtures when extraction regresses. The
// conversation-page entries below were re-mapped to the "app-shell" DOM and verified
// against the live page on 2026-09-29 (docs/live-dom-verification.md); the sidebar and
// project entries further down still describe the pre-app-shell DOM and are re-mapped by
// their own slices (docs/design/chatgpt-app-shell-remap.md).

export const selectors = {
  /**
   * One message unit — the user side or the assistant side of a turn. A turn
   * (`[data-turn-key]`) holds up to two of these, in reading order: the user unit first,
   * then the assistant unit; an assistant-only turn (a scheduled task) or an unanswered
   * prompt holds one. Every unit carries this attribute and nothing else in the thread
   * does. Verified against the live page (2026-09-29): 20 conversations plus a 31-turn walk.
   */
  message: '[data-chatgpt-search-message-ids]',
  /**
   * Attribute on `message` holding its provider message id(s), whitespace-separated. A user
   * unit holds one id; an assistant unit holds its id twice, or several ids when the reply
   * spans tool steps — the last one is the reply itself. Verified against the live page
   * (2026-09-29): last tokens unique across every unit measured.
   */
  messageIdAttr: 'data-chatgpt-search-message-ids',
  /**
   * The screen-reader-only role heading inside an assistant unit. There is no user
   * counterpart — the user heading carries no attribute — so the user side is recognised
   * by `userMessage` instead. Verified against the live page (2026-09-29).
   */
  assistantRoleMarker: '[data-conversation-role="assistant"]',
  /**
   * The user unit, matched on its Tailwind group name (`group/user-message`) with an
   * attribute-word match so the `/` needs no escaping. Structural, not the bubble: an
   * image-only prompt renders no `[data-user-message-bubble]` at all, only its tiles.
   * Verified against the live page (2026-09-29).
   */
  userMessage: '[class~="group/user-message"]',
  /**
   * A conversation turn. Used only to tell an inline embed (inside a turn) from the
   * page-covering deep-research view (outside one) — see `expandedReportFrame`. Verified
   * against the live page (2026-09-29).
   */
  turn: '[data-turn-key]',

  /** Raw user text: the pre-wrap block inside the user bubble. Verified against the live page (2026-09-29). */
  userText: '[data-user-message-bubble] .whitespace-pre-wrap',
  /**
   * Inline code inside `userText`: the bubble renders a backtick-quoted span of the typed
   * prompt as `<code>` and drops the backticks, so they are put back when reading. Nothing
   * else in the prompt is rendered (`**bold**` stays literal). Verified against the live
   * page (2026-09-29).
   */
  userInlineCode: 'code',
  /**
   * The rendered-Markdown form of `userText`. A prompt holding a fenced block renders
   * through the same Markdown pipeline as a reply — paragraphs, inline-code spans, code
   * blocks — inside this root, instead of as plain text; it is serialized like a reply.
   * Verified against the live page (2026-09-29): 25 of one conversation's 31 prompts.
   */
  userMarkdown: '[data-markdown-text-tone="user-message"]',
  /**
   * Rendered assistant prose root, exactly one per assistant unit. NOT
   * `[data-markdown-copy-content]`, which exists only inside a writing block (`richBlock`).
   * Verified against the live page (2026-09-29).
   */
  assistantMarkdown: '[data-markdown-text-style="assistant-message"]',

  /**
   * An uploaded file inside a user unit: a resource card whose button's `aria-label` is
   * the file name. The card carries no other readable text beyond a localized kind label,
   * so the name is pulled from here to describe an otherwise text-free prompt (AGENTS.md
   * #4). An image prompt is a different tile (an `<img>`), handled as `[Image]`. Verified
   * against the live page (2026-09-29) with an uploaded `.txt`.
   */
  attachmentTile: '[class~="group/resource-card"] > button[aria-label]',

  /**
   * Scroll viewport of the message list. It is `flex-direction: column-reverse`, so its
   * `scrollTop` runs from `-(scrollHeight - clientHeight)` (top) to `0` (bottom) — the
   * adapter's scroll helpers read the direction rather than assume `0` is the top. It
   * windows turns (about six nodes at a time) and mounts older turns as the top is
   * reached. Verified against the live page (2026-09-29).
   */
  scrollContainer: '[data-app-action-timeline-scroll]',

  /**
   * The header action bar holding ChatGPT's native Share and conversation-options
   * controls, inside the app-shell titlebar. The export buttons are injected here so they
   * sit inline with Share instead of a fixed overlay. Matched on the titlebar's stable
   * `data-testid` plus the bar's `gap-toolbar-action` token (unique on the page). Verified
   * against the live page (2026-09-29).
   */
  headerActions: '[data-testid="app-shell-header-context-menu-surface"] .gap-toolbar-action',

  /**
   * The expanded deep-research report view. ChatGPT renders it as a cross-origin sandbox
   * iframe that covers the page and carries its own export control, while the conversation
   * header — and with it `headerActions` — is gone from the top document. Matched only to
   * suppress the fallback overlay, which would otherwise float over that view's own chrome;
   * nothing is ever injected into the frame (it is another origin).
   *
   * Scoped to the `deep-research.` connector subdomain, NOT the whole
   * `web-sandbox.oaiusercontent.com` sandbox host: that host serves connector/app embeds
   * generally, and matching it wholesale would suppress the fallback on any conversation
   * carrying such an embed — deleting the toolbar outright exactly when the header selector
   * has drifted and the fallback is the only thing left (see the fallback's contract in
   * `syncButtons`). The adapter additionally requires the frame to sit outside a conversation
   * turn, since an inline embed of the same kind renders inside one.
   *
   * Host observed live as `connector-openai-deep-research.web-sandbox.oaiusercontent.com`
   * (2026-08-26). The inline-embed case is reasoned from that host's naming, not captured in
   * a fixture — re-verify when a fixture with an inline connector embed exists. NOT
   * re-measured on the app-shell DOM: the account measured on 2026-09-29 held no
   * deep-research conversation, so only the "outside a turn" test moved (to `turn`).
   */
  expandedReportFrame: 'iframe[src*="deep-research.web-sandbox.oaiusercontent.com"]',

  /**
   * ChatGPT's native Share button, queried inside `headerActions` — the anchor the export
   * buttons are placed to the left of. It has no `data-testid` and its `aria-label` is
   * localized (`"공유"` in ko), so it is matched structurally: the bar's direct-child button
   * that opens no menu (the options button carries `aria-haspopup`). Direct child only, so
   * the injected export buttons — nested in their own container — never match. Verified
   * against the live page (2026-09-29).
   */
  shareButton: ':scope > button:not([aria-haspopup])',

  /**
   * An assistant code block, in any of its three renderings: a static `<pre><code>`, a
   * static `code.whitespace-pre!`, or a CodeMirror 6 editor (`codeMirror*` below). Verified
   * against the live page (2026-09-29).
   */
  codeBlock: '[data-markdown-copy="code-block"]',
  /**
   * Chrome ChatGPT's own copy action leaves out: code-block headers (their text is the
   * language label), table action bars. Verified against the live page (2026-09-29).
   */
  copyExclude: '[data-markdown-copy="exclude"]',
  /** Inline code — a `<span>`, not a `<code>`. Verified against the live page (2026-09-29). */
  inlineCode: '[data-markdown-copy="inline-code"]',
  /**
   * A writing block (a "document" card): header chrome plus `richBlockContent`, an
   * ordinary p/ul/li tree. Verified against the live page (2026-09-29).
   */
  richBlock: '[data-markdown-copy="rich-block"]',
  richBlockContent: '[data-markdown-copy-content]',
  /** Favicon inside a citation chip — decoration, not content. Verified against the live page (2026-09-29). */
  citationFavicon: '[data-testid="chatgpt-citation"] img',
  /**
   * CodeMirror 6 internals of a hydrated code block. `.cm-content` carries the language in
   * `data-language` and holds one `.cm-line` per source line (no newline characters);
   * lines outside CodeMirror's viewport are replaced by `.cm-gap` spacers — measured 36 of
   * 150 lines rendered — so a gapped block is read by scrolling its pane.
   * `.cm-lineWrapping` on the content means line heights vary and the block cannot be read
   * that way. Verified against the live page (2026-09-29).
   */
  codeMirrorContent: '.cm-content',
  codeMirrorLine: '.cm-line',
  codeMirrorGap: '.cm-gap',
  codeMirrorLanguageAttr: 'data-language',
  codeMirrorWrappingClass: 'cm-lineWrapping',

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
