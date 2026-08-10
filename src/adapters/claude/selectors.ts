// Every Claude DOM selector lives here, exactly once (docs/conventions.md). When
// Claude's markup changes, this is the one file to update. Claude's DOM is unstable —
// re-verify against the live page and refresh the fixture when extraction regresses.
// See docs/live-dom-verification.md for how a stamp below is earned.

export const selectors = {
  /**
   * A user turn. Claude marks only the user side with a test id; assistant turns carry
   * no equivalent, which is why `turn` below is a union rather than one attribute.
   * The element holds the message body directly (a `p.whitespace-pre-wrap` per
   * paragraph). Verified against the live page (2026-07-25): 7 present on a 7-user-turn
   * viewport, corroborated by an equal count of `data-user-message-bubble`.
   */
  userMessage: '[data-testid="user-message"]',

  /**
   * The assistant's rendered prose container — Claude's analogue of ChatGPT's
   * `.markdown`. Holds `p.font-claude-response-body`, lists, and `pre > code` blocks.
   * Verified against the live page (2026-07-25); `.markdown` and `[class*="prose"]`
   * both resolve to zero elements on Claude, so no ChatGPT selector is reusable here.
   */
  assistantMarkdown: '.standard-markdown',

  /**
   * Any message turn, either role, matched in one query so document order alone gives
   * the on-screen interleaving — Claude exposes no per-turn wrapper carrying the role,
   * so a turn IS either a user bubble or an assistant prose container. Role is then
   * decided by testing the matched element against `userMessage`. Verified against the
   * live page (2026-07-25): no `.standard-markdown` is nested inside a
   * `[data-testid="user-message"]` (overlap count 0), so the two sets are disjoint and
   * a turn can never be counted twice.
   *
   * One row can still match TWICE for a reason that is not a second message: expanding a
   * turn's extended-thinking block adds a second, un-nested `.standard-markdown` holding the
   * thinking text (measured 2026-07-29 — matches went 1 → 2 on one row). `buildMessages` joins
   * every match in a row, so an expanded block is exported as part of the assistant's message.
   * The thinking container is distinguishable: it has an ancestor carrying `data-timeline-text`
   * (class `group/timeline-text`), which the answer container does not.
   */
  turn: '[data-testid="user-message"], .standard-markdown',

  /**
   * The virtualizer's row wrapper, an ancestor of each turn. Its `data-index` is the
   * turn's position in the full conversation, which is the only stable identity Claude
   * exposes — there is no `data-message-id` analogue — so it serves as both the dedupe
   * key and the sort key while accumulating across scroll rounds, and its numbering is
   * what lets extraction detect a gap instead of silently returning a partial.
   * Verified against the live page (2026-07-25): 50 distinct values were surfaced on a
   * conversation that never rendered more than 16 turn nodes at once. A second walk the
   * same day confirmed the numbering is **0-based and dense** (0…55 on a 56-row
   * conversation) — which is why `buildMessages` can treat a range starting above 0 as a
   * hole. A row is NOT guaranteed to hold exactly one `turn`, or any: see
   * docs/live-dom-verification.md → "not every indexed row is a readable turn".
   */
  turnRow: '[data-index]',

  /** Attribute holding the row's conversation-position index. */
  turnIndexAttr: 'data-index',

  /**
   * The `role="article"` wrapper inside a virtualizer row. Its `aria-setsize` declares how
   * many rows the WHOLE conversation has, which is the only bound extraction has on the
   * *trailing* end — `data-index` contiguity proves nothing about turns past the last one
   * collected. Read via `setSizeAttr` below.
   *
   * Verified against the live page (2026-07-25, second measurement session): four
   * conversations were walked end to end — 14, 16, 26 and 56 rows — and every one of their
   * **112 indexed rows carried it** (`rowsArticleNoSetsize` 0, `rowsNoArticle` 0), including
   * the attachment-only row that has no `user-message` node at all. The value was **constant
   * across each entire walk** (one distinct value per conversation, over 50–74 record
   * rounds) and equalled `maxIndex + 1` every time. It counts **rows, not messages**: the
   * 56-row conversation rendered 58 turn nodes and the 26-row one 27, because a row may hold
   * several assistant blocks. Twelve further conversations (2…56 rows) were spot-checked and
   * all carried it. A separate hydration trace found no low intermediate value inside a
   * conversation — the rows go from absent (no `role="article"` at all for ~600 ms) straight
   * to the full count — which is what makes the smallest observed value a safe reading.
   */
  messageArticle: '[role="article"][aria-setsize]',

  /**
   * Attribute on `messageArticle` declaring the conversation's total row count. Verified
   * against the live page (2026-07-25): appending a turn raised it (2 → 4 across one
   * exchange), and across 60 samples spanning a streaming response the declared total never
   * disagreed with the number of rendered rows — so it tracks the live list rather than
   * being fixed when the page loads.
   */
  setSizeAttr: 'aria-setsize',

  /**
   * Claude's assistant response wrapper exposes the generation state for the newest
   * assistant row. The marker wraps `.standard-markdown`; its value is `"true"` while
   * generating and `"false"` after the final text chunk. A missing marker is deliberately
   * not treated as completion because the row can render before the wrapper mounts.
   * Verified against the live page (2026-07-29; rechecked 2026-08-09).
   */
  streamMarker: '[data-is-streaming]',

  /** Attribute carrying the `true`/`false` stream state. */
  streamStateAttr: 'data-is-streaming',

  /**
   * Scroll viewport that virtualizes the message list. Claude *recycles* turn nodes —
   * scrolling to the top dropped the rendered count from 16 to 8 while surfacing
   * different turns — so extraction must scroll this element and accumulate, and a
   * one-shot `querySelectorAll` would silently return a fraction of the conversation
   * (AGENTS.md #4). Matched on a stable data attribute rather than its class soup.
   * Verified against the live page (2026-07-25): the only content scroll port,
   * `scrollHeight 2922 > clientHeight 592`, carrying `data-autoscroll-container`.
   */
  scrollContainer: '[data-autoscroll-container]',

  /**
   * A file-attachment thumbnail inside a virtualizer row. Its `alt` carries the file name
   * verbatim, which is what `[File: …]` reports — the same shape the ChatGPT adapter emits
   * from its own attachment tiles. Verified against the live page (2026-07-25): a user turn
   * holding one PDF rendered `<img alt="<name>.pdf">` inside the tile, and the tile's own
   * `data-testid` was the file name too — `alt` is preferred because a test id whose *value*
   * is user data is not a contract, while `alt` is the standard accessible name.
   *
   * Scoped to the measured `button > img` path rather than a bare `img[alt]`: the query runs
   * against a whole virtualizer row, so any decorative or control image carrying an `alt`
   * would otherwise be reported as a file — fabricating a name, the exact failure the
   * `alt`-over-`data-testid` rationale above exists to avoid. Claude's `group/thumbnail`
   * wrapper class is avoided in favour of the standard tags. If Claude restructures the tile,
   * this stops matching and the row goes back to failing loud, which is the safe direction.
   *
   * **Re-verified 2026-07-29, and it covers only HALF the attachments Claude renders.** There
   * are two tile shapes; this matches the first — a preview tile
   * `div[data-testid="<filename>"] > button > img[alt="<filename>"]`, measured for a PDF and a
   * 600×400 PNG. The second is a *file card* with no `<img>` in the row at all; it is matched
   * by `attachmentCard` below, and the adapter reads BOTH. See docs/live-dom-verification.md →
   * Claude → 2026-07-29.
   */
  attachmentImage: 'button > img[alt]',

  /**
   * The second attachment shape — a *file card*, which carries the file name in an `h3` and
   * renders **no `<img>` anywhere in the row**, so `attachmentImage` cannot see it. Measured
   * against the live page (2026-07-29) for a `.txt`, a 4×4 PNG, and a pasted image, each file
   * created in the session so the shape is attributable to a known file.
   *
   * Both shapes must be read, and neither may be selected by file type: a PNG was measured
   * producing **each** of them (600×400 → preview tile, 4×4 → card), which rules out extension
   * as the determinant, and what does select between them was NOT established (AGENTS.md #5).
   * Until it is, the adapter matches on either shape rather than dispatching.
   *
   * The measured path is `div[data-testid="file-thumbnail"] > button > div > h3`. A descendant
   * `h3` is used rather than that full child chain because — unlike `attachmentImage`, whose
   * own anchor is a bare `img[alt]` and so needed `button >` to avoid claiming decorative
   * images — the `file-thumbnail` test id is a **constant** rather than user data, so it
   * already confines the query to the card, and an inserted wrapper must not silently stop
   * extraction. The name comes from the `h3` and not the button's `aria-label`, which was
   * measured as `"pv-probe-note.txt, txt, 4줄"` — localized and carrying extra metadata, so it
   * is not a clean name source.
   */
  attachmentCard: '[data-testid="file-thumbnail"] h3',

  /**
   * Ancestor marking an extended-thinking block, so its text can be told from the answer's.
   * Expanding a turn's thinking chip adds a SECOND, un-nested `.standard-markdown` to the row
   * — `selectors.turn` goes from 1 match to 2 — and every match in a row is joined, so without
   * this the exported message silently depends on whether the user had the block open.
   *
   * Measured rather than guessed (2026-07-29): the thinking block has an ancestor carrying
   * `data-timeline-text` (class `group/timeline-text`) three levels above the
   * `.standard-markdown`; the answer block has no such ancestor. Matched on the data attribute
   * rather than the class, which is Tailwind-ish and far likelier to churn.
   */
  thinkingContainer: '[data-timeline-text]',

  /**
   * Claude's per-message "edit" control, which exists ONLY on the user's own messages.
   * Verified against the live page (2026-07-25) by surveying every `data-testid` in the 54
   * single-turn rows of a 56-row conversation and partitioning by role: `action-bar-edit`
   * and `user-message` were user-exclusive, `action-bar-read-aloud`/`action-bar-retry`
   * assistant-exclusive, `action-bar-copy` shared. That exclusivity is what lets an
   * attachment-only row — which has no `user-message` node at all — be attributed to the
   * user without guessing.
   */
  userActionBar: '[data-testid="action-bar-edit"]',

  /**
   * Claude's assistant artifact card. The root carries the literal `group/artifact-block`
   * class token and the content column carries `artifact-block-cell`; title and kind are
   * separate descendants with the measured class-token combinations. The selector is kept
   * token-based because `/` is part of the captured class token and not a CSS descendant
   * separator. Verified against the live page (2026-08-09).
   */
  artifactCard: 'div[class~="group/artifact-block"]',
  artifactCell: '[class~="artifact-block-cell"]',
  artifactTitle: '[class~="leading-tight"][class~="text-sm"][class~="line-clamp-1"]',
  artifactKind: '[class~="text-xs"][class~="line-clamp-1"]',

  /**
   * Claude's persistent navigation surfaces measured on 2026-08-09.
   *
   * The sidebar is matched on the ELEMENT measured (`aside`), never on its accessible name:
   * the 2026-08-09 measurement was taken on a Korean-locale account, where the label reads
   * `사이드바`, and Claude localizes it. Pinning the label would make the whole navigation
   * track dead on every other UI language. `resolveSidebar` narrows a page's asides to the
   * one carrying `sidebarConversationLink` anchors, which is the same measured fact
   * (19 `/chat/:id` links inside that aside) minus the locale dependency.
   */
  sidebar: 'aside',
  sidebarConversationLink: 'a[href^="/chat/"]',
  /**
   * The project home's conversation table. `main table` alone is not proof of the project
   * home — an assistant markdown table renders inside `<main>` on a `/chat/<id>` page too —
   * so every consumer goes through `resolveProjectTable`, which keeps only a table that
   * actually carries `projectConversationLink` anchors.
   */
  projectTable: 'main table',
  projectRow: 'tbody > tr',
  projectConversationLink: 'a[href^="/chat/"]',

  /**
   * The header action bar holding Claude's native controls (Share, chat options). The
   * export buttons are injected here so they sit inline with Share instead of a fixed
   * overlay covering it. Verified against the live page (2026-07-25), and re-verified
   * the same day with the **built extension loaded**: the container mounted inside this
   * element with `data-prompt-vault-placement="native"` — i.e. the overlay fallback was
   * never reached.
   */
  headerActions: '[data-testid="wiggle-controls-actions"]',

  /**
   * Claude's native Share button inside the header action bar — the anchor the export
   * buttons are placed to the left of (beside it, not replacing it). Verified against
   * the live page (2026-07-25), and re-verified the same day with the built extension
   * loaded: the container did precede this element, and all 28 tokens of
   * `toolbarButtonClass` were present on this button's own class list, giving our buttons
   * a computed color identical to it in BOTH themes (`rgb(11,11,11)` light,
   * `rgb(255,255,255)` dark). See `docs/live-dom-verification.md` → Claude.
   */
  shareButton: '[data-testid="wiggle-controls-actions-share"]',
} as const;

/**
 * Suffix Claude appends to the conversation title in `document.title`
 * (`"<conversation title> - Claude"`). Stripped to recover the bare title; a page whose
 * title is exactly `Claude` has no conversation title yet and falls back. Verified
 * against the live page (2026-07-25).
 */
export const TITLE_SUFFIX = ' - Claude';
