// Every ChatGPT DOM selector lives here, exactly once (docs/conventions.md). When
// ChatGPT's markup changes, this is the one file to update. ChatGPT's DOM is unstable —
// re-verify against the live page and refresh fixtures when extraction regresses. The
// conversation-page entries below were re-mapped to the "app-shell" DOM and verified
// against the live page on 2026-09-29 (docs/live-dom-verification.md), and so were the
// sidebar and project entries further down (docs/design/chatgpt-app-shell-remap.md,
// slices 2-3).

export const selectors = {
  /**
   * The route page on screen. The app-shell keeps previously visited routes mounted as
   * `display: none` siblings (measured 2026-09-29: 4 hidden + 1 active after a few
   * navigations), each with its own header, thread and messages — so every page-level query
   * is scoped to this wrapper, or it lands on a hidden conversation first. The left sidebar
   * lives outside it. Verified against the live page (2026-09-29).
   */
  activePage: '[data-app-shell-active-page="true"]',
  /** Any route page wrapper, active or hidden — its presence marks an app-shell document. */
  routePage: '[data-app-shell-active-page]',

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
   * The thread's "loading earlier messages" status, rendered above the first turn for as long
   * as older turns remain unmounted — present from first paint, gone once the oldest turn
   * mounts. Depth-pinned under the thread root so the scroll footer's `sr-only`
   * `[role="status"]` never matches. Its absence proves nothing (a short conversation and a
   * drifted selector look alike), so it only ever shortens the load after it was SEEN.
   * Verified against the live page (2026-09-29): a 31-turn and a 2-turn conversation.
   */
  olderTurnsLoading: '[data-thread-find-target="conversation"] > * > [role="status"]',

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
   * The Recents conversation list in the app-shell left sidebar. Only top-level `/c/` chats
   * are listed here — project chats are not, and the Projects section above renders no
   * anchors — so scoping to it excludes project/GPT chats and the composer. Its id is a
   * fixed key, not a localized label. Verified against the live page (2026-09-29).
   */
  sidebarHistory: '[data-sidebar-project-container-id="chats"]',

  /**
   * A single past-conversation link inside `sidebarHistory` — an
   * `a[data-interactive-row-link]` whose `href` is `/c/<id>` (deduped by path id) and whose
   * `aria-label` holds the full, untruncated title. Verified against the live page
   * (2026-09-29).
   */
  sidebarConversationLink: 'a[href^="/c/"]',

  /**
   * EVERY conversation row inside `sidebarHistory` — the count `pageParityGate` reads.
   * On the app-shell sidebar the rendered increment (~10 rows) is not the server page
   * (20 per fetch), so parity is secondary evidence here; `sidebarLoadingStatus` is the
   * primary one. Never used for extraction. Verified against the live page (2026-09-29).
   */
  sidebarConversationRow: '[data-sidebar-chatgpt-conversation-key]',

  /**
   * The Recents list's trailing loading row (a `[role="listitem"]` holding a
   * `[role="status"]` and shimmer bars), shown while more rows are owed. Excludes conversation
   * rows, so a status indicator inside one can never read as a pending page. Its presence is
   * evidence a page is still coming; its absence is NOT evidence of the end — a 429 on a
   * fresh load removed it with the list cut short. Verified against the live page
   * (2026-09-29).
   */
  sidebarLoadingStatus: '[role="listitem"]:not([data-sidebar-chatgpt-conversation-key]) [role="status"]',

  /**
   * A conversation link on a Project home page (`/g/g-p-<id>/project`) or in the
   * persistent project sidebar expando shown while a project conversation is open.
   * `href` is `/g/g-p-<id>[-slug]/c/<convId>` — the slug varies by context, so match
   * on the `/g/g-p-` prefix plus the `/c/` segment and key by the stable `convId`.
   * On the project home page these live in a `<main>` `<ol>` of
   * `<li class="group/project-chat">`; only the project home page is scraped for the
   * bulk list, so no extra scoping is needed. An app-shell project CONVERSATION page links
   * to no other project conversation at all. Verified against the live page (2026-09-29).
   */
  projectConversationLink: 'a[href*="/g/g-p-"][href*="/c/"]',

  /**
   * The conversation title inside a `projectConversationLink` on a project home page —
   * a `text-sm font-medium` block holding the human title (the sibling block is a
   * message-body preview snippet, also `text-sm` but NOT `font-medium`, so both classes
   * are required to avoid picking the snippet). Best-effort: extraction falls back to
   * the link's text when this is absent. Verified against the live page (2026-09-29).
   */
  projectConversationTitle: '.text-sm.font-medium',

  /**
   * The link back to a project's home page shown while a project conversation is open
   * (`href` ends `/project`, in the header on the app-shell DOM). Used to return to the
   * project between bulk opens and after a bulk run. Verified against the live page
   * (2026-09-29).
   */
  projectBackLink: 'a[href$="/project"]',
} as const;
