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
   *
   * **These four stay class-token based because nothing else exists — measured, not assumed
   * (2026-08-10).** The card was surveyed across four artifact kinds (HTML, PY, MD, JSX; three
   * of them created in-session so the shape is attributable to a known artifact), and the only
   * `data-*` attribute anywhere inside a card is a single `data-cds="Button"` on the download
   * control. There is no attribute on the card, the title or the kind. So the "anchor these on
   * measured attributes" fix this file once carried as a follow-up is **not achievable**, and
   * that is the finding rather than an omission.
   *
   * The hazard that follow-up was filed against was also measured and did not appear:
   * `artifactKind`'s token pair matched **exactly once per card in all four kinds** — no
   * timestamp or version badge competes for it. Should one ever appear, `artifactMarkers` in
   * `src/adapters/claude/index.ts` requires exactly one non-empty match and throws otherwise,
   * so the failure is loud (AGENTS.md #4), not a silently mislabelled artifact.
   *
   * What IS structurally stable, recorded in case these tokens do churn: the text column inside
   * `artifactCell` held exactly two children in all four cards — title first, kind second. A
   * positional rewrite was considered and rejected: it trades one fragile handle (utility
   * classes) for another (a child-index chain), with no measured advantage.
   *
   * Note for whoever touches the exported string: the kind text is **localized** — `문서 · MD`
   * and `코드 · JSX` were measured on this ko-KR account. Only the leading noun is translated;
   * the trailing token after the ` · ` separator is the artifact's format and is language-neutral.
   * `artifactMarkers` in `src/adapters/claude/index.ts` therefore exports only that token, so
   * `[Artifact: <title> (MD)]` is the same string on every UI language. Only the exact two-part
   * shape is normalized; any other kind is exported verbatim, which is what shipped before this
   * and so can never be a regression. See `artifactFormatToken` for why it does not fail loud.
   */
  artifactCard: 'div[class~="group/artifact-block"]',
  artifactCell: '[class~="artifact-block-cell"]',
  artifactTitle: '[class~="leading-tight"][class~="text-sm"][class~="line-clamp-1"]',
  artifactKind: '[class~="text-xs"][class~="line-clamp-1"]',

  /**
   * Claude's persistent navigation surfaces, measured 2026-08-09 and re-measured 2026-08-10.
   *
   * The sidebar is matched on the ELEMENT measured (`aside`), never on its accessible name:
   * the measurements were taken on a Korean-locale account, where the label reads `사이드바`,
   * and Claude localizes it. Pinning the label would make the whole navigation track dead on
   * every other UI language.
   *
   * **The uniqueness this rests on is now measured directly (2026-08-10), where PR #58 could
   * only derive it.** On both `/new` and a `/chat/<id>` page: exactly ONE `aside` in the
   * document, it is the one carrying the sidebar links (20 on each route), and **zero**
   * `a[href^="/chat/"]` exist anywhere outside it. So `resolveSidebar`'s narrowing is not
   * merely a locale-independent restatement of a label — it selects the same element the
   * label would have, and nothing else on the page competes for it.
   *
   * Two alternatives were measured and rejected rather than left unexamined:
   * - **There is no nav landmark.** `nav` and `[role="navigation"]` both resolve to zero
   *   elements on both routes, so the landmark this was once expected to hang on does not exist.
   * - The aside does carry locale-independent attributes — `data-variant="web"` and
   *   `data-density="comfortable"` — but both are *configuration* values (platform, and the
   *   user's density preference), so pinning either value would break under a different
   *   setting, and matching on presence alone is no more discriminating than the containment
   *   test already shipped.
   *
   * Sidebar rows additionally carry `data-row-key="chat:<uuid>"` (20/20 on both routes), which
   * is conversation identity without an `href` parse. Nothing reads it today; it is recorded
   * here because it is the stable per-row handle if one is ever needed.
   */
  sidebar: 'aside',
  sidebarConversationLink: 'a[href^="/chat/"]',
  /**
   * The project home's conversation table. `main table` alone is not proof of the project
   * home — an assistant markdown table renders inside `<main>` on a `/chat/<id>` page too —
   * so every consumer goes through `resolveProjectTable`, which keeps only a table that
   * actually carries `projectConversationLink` anchors.
   *
   * **A design-system attribute exists and is deliberately NOT pinned here. Measured
   * 2026-08-10:**
   *
   * | Page | `data-cds` on the table | inside `[data-cds="DataTable"]` | chat links |
   * |---|---|---|---|
   * | project home (2 projects, 1 and 4 members) | `Table` | yes (ancestor depth 2) | 1 / 4 |
   * | `/recents` | `Table` | yes | 25 |
   * | `/chat/<id>` assistant markdown table | **none** | no | 0 |
   *
   * Narrowing to `main table[data-cds="Table"]` was tried on that evidence and reverted,
   * because it makes the failure mode WORSE rather than better — the trade only became visible
   * once the reachable paths were traced:
   *
   * - **It buys almost nothing reachable.** The markdown table only exists on `/chat/<id>`, and
   *   every project consumer is route-gated before it can run: `projectToolbarMount` is reached
   *   only via `syncButtons` → `isProjectPage` → `matchesProject` (`src/content/mount.ts`), and
   *   `openProjectBulkExport` gates on `pickProjectAdapter(location.href)`. So the markdown
   *   table is never handed to a consumer today.
   * - **It costs a silent failure.** If Claude renames that one unversioned attribute, the
   *   selector matches nothing on a real project home, and a list that resolves to no table is
   *   an *empty* list rather than a loud one — the bulk panel's "no conversations" state,
   *   indistinguishable from a genuinely empty project (AGENTS.md #4). Under the plain tag
   *   selector the same drift changes nothing at all.
   * - **It was measured on one route family.** `PROJECT_PATHS` in `./matches.ts` matches both
   *   `/cowork/project/<id>` and `/project/<id>`; only the former was measured on 2026-08-10,
   *   so pinning would rest on an unmeasured assumption for the other (AGENTS.md #5).
   *
   * What the session did change is the missing-table case below it: `listProjectConversations`
   * now fails loud when it is ON a project route and resolves no table at all, instead of
   * reporting an empty project. That guard is what makes any future attribute pinning safe, and
   * it is worth having on its own.
   */
  projectTable: 'main table',
  projectRow: 'tbody > tr',
  projectConversationLink: 'a[href^="/chat/"]',

  /**
   * The same anchor, scoped to the page body — for the one query that runs against the whole
   * document rather than against a resolved table or row.
   *
   * `projectConversationLink` is byte-identical to `sidebarConversationLink`, which is correct
   * while it is used inside a table but catastrophic document-wide: the app shell's `aside` carries
   * up to 20 recent-chat links on every measured route (2026-08-10 / 2026-08-11), so an unscoped
   * probe reports "this page has conversation links" for every account that has any history at all.
   * `listProjectConversations` uses this scoped form to decide that a project home with no table
   * also has no stranded list — `main` is the region every project-home measurement was taken in,
   * and the region `projectTable` already restricts itself to.
   */
  projectMainConversationLink: 'main a[href^="/chat/"]',

  /**
   * Proof that a project home finished rendering, independent of whether it holds any
   * conversations. Verified against the live page (2026-08-11).
   *
   * An empty project renders **no `main table` at all** — not a knowledge table, none — so
   * "project route with no conversation table" covers two different situations: the ordinary
   * empty project, and a page that has not rendered the project home. `listProjectConversations`
   * must return `[]` for the first and fail loud for the second (AGENTS.md #4), and this is what
   * separates them. Measured presence: 1 on the empty project created for that session, 1 on each
   * of the two populated projects, and **0** on `/chat/<id>`.
   *
   * The doc-upload control is used as the marker because it is part of the project home's own
   * chrome rather than of its list, so it is there before, during and after the list is empty. It
   * is a `data-testid`, which is a test hook rather than a product API — but every other candidate
   * on the page was worse: `chat-input` also renders on `/chat/<id>`, and the visible empty-state
   * text is localized. If Claude renames it, an empty project goes back to reporting a markup
   * change, which is the loud direction, not a silent one.
   *
   * **It is not a table-render signal, and is not used as one.** Measured on the same day: on a
   * populated project the shell appears ~104 ms after navigation and the table ~520 ms, so for
   * ~350 ms a populated project looks exactly like an empty one. `listProjectConversations`
   * therefore also requires that no `projectConversationLink` exists anywhere before it will call
   * a project empty; see the case analysis on that function.
   */
  projectShell: '[data-testid="project-doc-upload"]',

  /**
   * The `/recents` history page's conversation table — the surface the history bulk track is
   * offered on, because it is the WHOLE list where the sidebar shows only its newest slice.
   * Verified against the live page (2026-08-11): `/recents` rendered exactly **1** `main table`
   * with **26** rows and **exactly one** `a[href^="/chat/"]` per row (26/26), while the same
   * page's `aside` held **20** — the cap this track exists to get past.
   *
   * The list is **fully rendered, not virtualized and not recycling** at that size: a 12-round
   * scroll walk of its port (`.dframe-pane-scroller`, 1500 ms dwell) held 26/26 every round with
   * `scrollHeight` constant at 1369, and `/recents` tracked the account's growth (25 links on
   * 2026-08-10 → 26 on 2026-08-11), so the page is not itself capped.
   *
   * **Scope limit:** "does not page" is established at 26 conversations only. The shape on a much
   * larger account is `[unknown — read docs/live-dom-verification.md to verify]`, which is why
   * `loadMoreRecentsConversations` keeps the `onIncomplete` completeness signal rather than
   * treating one round as proof of a full list (AGENTS.md #4). The shape on an account with ZERO
   * conversations is `[unknown — read docs/live-dom-verification.md to verify]` as well.
   *
   * `data-cds="Table"` was measured on this table (inside a `[data-cds="DataTable"]` ancestor) and
   * is deliberately NOT pinned, for the same reason as `projectTable` above: it is one unversioned
   * design-system attribute, and if Claude renames it the selector matches nothing, turning the
   * complete history into a silently EMPTY list rather than a loud failure. Under the plain tag
   * selector the same drift changes nothing. What guards the ambiguity instead is the route —
   * `listRecentsConversations` fails loud when it is on `/recents` and resolves no table at all.
   */
  recentsTable: 'main table',
  recentsRow: 'tbody > tr',
  recentsConversationLink: 'a[href^="/chat/"]',

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
