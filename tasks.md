## Review Backlog

### Ticket 3 follow-up (ChatGPT adapter) — manual verification & edge cases

- [ ] [VERIFY] Load-unpacked on a long/virtualized live conversation: confirm `autoScrollToLoad` pulls in all lazy-rendered older turns, the extracted `Conversation` captures the full history in order, and a scroll that never settles fails loud (`ExtractionError`). Deferred — needs a logged-in browser session; the auto-scroll path has no unit coverage (fixtures skip the live path).

### Bulk panel "Load more" follow-up

- [ ] [VERIFY] Load-unpacked on a virtualized history sidebar AND a project home page: open the bulk panel, click "Load more" once, and confirm `findScrollableAncestor` targets the real scroll container so previously-hidden conversations appear and become selectable (existing selections preserved), the button settles into its disabled done state when nothing new remains, and a scroll that never settles fails loud (`ExtractionError`) into the status line. Deferred — the scroll-container discovery cannot be verified against live markup without a logged-in browser session (mirrors the `autoScrollToLoad` VERIFY above).
- [ ] [VERIFY] Confirm ChatGPT's history sidebar / project list is **append-on-scroll** (rows stay mounted as you scroll down) rather than a **windowed/recycling** virtualizer that trims off-screen rows from the top. The whole bulk track (both the pre-existing `listConversations` single-scan AND the new "Load more") assumes accumulation: `loadMoreConversations` counts distinct conversation ids so it keeps loading even if the node pool recycles, but the final single re-scan would still miss any rows trimmed off the top under a recycling virtualizer. If the live DOM turns out to recycle, the loader must accumulate the `SidebarConversation` list across scroll rounds instead of relying on one post-load scan. Deferred — needs a logged-in session with a long enough history to observe the DOM behavior.

### Header-blend buttons follow-up

- [ ] [VERIFY] In ChatGPT dark theme, confirm the native header controls retain matching colors and hover treatment. Light-theme placement, sizing, Share-button non-overlap, and SPA remounting were verified live on 2026-07-22.
