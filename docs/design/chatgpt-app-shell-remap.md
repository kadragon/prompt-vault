# ChatGPT app-shell DOM re-map

## Problem Statement

ChatGPT shipped a redesigned "app-shell" DOM. Measured on a logged-in `/c/<id>` page
(2026-09-29), every structural selector in `src/adapters/chatgpt/selectors.ts` that the
conversation page depends on now matches **0** elements:

| Selector (current) | Role | Live count |
|---|---|---|
| `#conversation-header-actions` | `headerActions` — toolbar mount | 0 |
| `[data-testid="share-chat-button"]` | `shareButton` — toolbar anchor | 0 |
| `[data-message-author-role]` | `message` — turn/role | 0 |
| `[data-message-id]` | `messageIdAttr` | 0 |
| `.markdown` | `assistantMarkdown` | 0 |
| `[data-scroll-root]` | `scrollContainer` | 0 |
| `#history` | `sidebarHistory` — bulk list scope | 0 |

User-visible effect: the export toolbar no longer finds the header, so it falls back to the
floating overlay in the bottom-right corner (user report, 2026-09-29). Worse, extraction finds no
messages, so MD/PDF export cannot produce a conversation — principle #4 should turn that into a
visible error, but the feature is broken either way. Bulk export is broken too (`#history` gone).
The shipped fixtures in `test/fixtures/chatgpt/` are the old DOM, so every unit test still passes.

## Solution

Re-map the ChatGPT adapter to the app-shell DOM, one vertical slice per page surface, each slice
earning fresh `Verified against the live page (YYYY-MM-DD)` stamps and a refreshed fixture per
`docs/live-dom-verification.md`. The `ConversationAdapter` interface and the content layer stay
as they are — this is a selector/extraction change inside `src/adapters/chatgpt/`.

## User Stories

- As a ChatGPT user, I want the MD/PDF buttons back in the conversation header, so that they sit
  beside Share instead of floating over the page.
- As a ChatGPT user, I want a single-conversation export to contain every user and assistant turn,
  so that my backup is complete.
- As a ChatGPT user, I want bulk export from the sidebar to work again, so that I can back up many
  conversations at once.
- As a ChatGPT user, I want project bulk export to work again, so that project chats are covered.

## Implementation Decisions

Measured structure (2026-09-29, one conversation, 5 turns — counts and attributes only):

- **Turn** — `[data-turn-key]` (5). Each turn holds BOTH the user side and the assistant side:
  one `[data-user-message-bubble]` and one element carrying `[data-conversation-role="assistant"]`.
  The old model (one node per message with a role attribute) no longer holds; the role of the user
  side is implied by the bubble, not by an attribute.
- **Message ids** — `[data-chatgpt-selection-message-id]` (1 per turn) and
  `[data-chatgpt-search-message-ids]` (on the user-message group).
- **User text** — `.whitespace-pre-wrap` still present (1 per turn).
- **Assistant content** — `[data-markdown-copy-content]`, but only in 2 of 5 turns. Resolved in
  slice 1: that attribute marks only a writing block's body; the prose root of every reply is
  `[data-markdown-text-style="assistant-message"]`.
- **Scroll container** — `[data-app-action-timeline-scroll]` (`.thread-scroll-container`), the
  only scrollable element in `<main>` taller than its viewport.
- **Header** — `header > [data-testid="app-shell-header-context-menu-surface"]`. Share is a
  `button[aria-label="공유"]` (localized — no `data-testid`) inside
  `div.flex.items-center.gap-toolbar-action`. Header slots
  `[data-app-shell-header-slot="start"|"end"]` exist; `end` held no buttons.
- **Sidebar rows** — `a[href^="/c/"][data-interactive-row-link][aria-label]` inside
  `[role="listitem"][data-sidebar-chatgpt-conversation-key]`; no `#history` container.

Decisions:

1. **No localized-text selectors.** Share's `aria-label` is UI-language dependent; the anchor must
   be found structurally (its container, a stable `data-*`), never by `"공유"`/`"Share"`.
2. **Slice order: conversation page → sidebar/bulk → projects.** Single-conversation export is the
   core feature and unblocks the others' extraction path.
3. **Fixtures are replaced, not patched.** Each slice captures a fresh sanitized fixture of the new
   DOM; old-DOM fixtures are removed once no test depends on them (no dual-DOM support — ChatGPT
   serves one DOM).
4. **Toolbar button classes** (`TOOLBAR_BUTTON_CLASS`, `PROJECT_TOOLBAR_BUTTON_CLASS`) are
   re-checked against the new header's native controls in slice 1 / slice 3.

## Testing Decisions

- Unit: existing `test/adapters/chatgpt/*.test.ts` re-pointed at new fixtures; `npm test` green.
- Live: per `docs/live-dom-verification.md` — load `dist/` unpacked, confirm buttons mount in the
  header (screenshot), and export one real conversation to MD and PDF, checking turn count against
  the page's `[data-turn-key]` count.
- Bulk slice: re-measure the `#history` page size (was 28 rows) and latency against the new
  container before trusting `pageParityGate` / `SIDEBAR_SCROLL_DEFAULTS`.

## Out of Scope

- Claude and Gemini adapters.
- New export features or format changes.
- Supporting the old ChatGPT DOM alongside the new one.

## Not yet specified

- The deep-research expanded frame (`expandedReportFrame`) in the new DOM — slice 1 found no
  deep-research conversation to measure; only its "outside a turn" test moved to
  `[data-turn-key]`. Attachment tiles and assistant content were resolved in slice 1 (see
  `docs/live-dom-verification.md`, 2026-09-29), which also found three things this spec did not
  foresee: a `column-reverse` message list, three code-block renderings including a virtualized
  CodeMirror editor, and prompts that render as Markdown.
- Slices 2–3 (2026-09-29, `docs/live-dom-verification.md`): the sidebar is the Recents list with
  a loading row; project conversation pages link to no other project chat; and the app-shell
  keeps hidden route pages mounted, so page reads are scoped to `[data-app-shell-active-page]`.
  Still open: the app-shell sidebar's page size and true end (429 blocked the walk), and project
  lists long enough to page.

## Further Notes

- Risk: ChatGPT may still be rolling the redesign out (A/B). If a fixture capture shows the old
  DOM on another account, record it in `docs/live-dom-verification.md` before deciding on
  dual support.
- Until slice 1 ships, the released extension on ChatGPT shows the overlay and fails export —
  worth a patch release as soon as slice 1 lands.
