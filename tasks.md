## Review Backlog

### Ticket 3 follow-up (ChatGPT adapter) — manual verification & edge cases

- [ ] [VERIFY] Load-unpacked on a long/virtualized live conversation: confirm `autoScrollToLoad` pulls in all lazy-rendered older turns, the extracted `Conversation` captures the full history in order, and a scroll that never settles fails loud (`ExtractionError`). Deferred — needs a logged-in browser session; the auto-scroll path has no unit coverage (fixtures skip the live path).

### Bulk panel "Load more" follow-up

- [ ] [VERIFY] Load-unpacked on a virtualized history sidebar AND a project home page: open the bulk panel, click "Load more" once, and confirm `findScrollableAncestor` targets the real scroll container so previously-hidden conversations appear and become selectable (existing selections preserved), the button settles into its disabled done state when nothing new remains, and a scroll that never settles fails loud (`ExtractionError`) into the status line. Deferred — the scroll-container discovery cannot be verified against live markup without a logged-in browser session (mirrors the `autoScrollToLoad` VERIFY above).
- [ ] [VERIFY] Live smoke-check "Load more" on a long history sidebar and a project home: the checklist must contain the FULL list (top rows included) and settle into the disabled done state. The recycling-virtualizer correctness gap is now closed in code — `loadMoreConversations` / `loadMoreProjectConversations` accumulate the `SidebarConversation` list across scroll rounds (unit-covered in `test/adapters/chatgpt/load-more.test.ts`), so rows a windowed/recycling virtualizer trims off the top are no longer dropped. This remaining item is only a live-markup confirmation, not an open risk. Deferred — needs a logged-in session with a long enough history.

### Header-blend buttons follow-up

- [ ] [VERIFY] In ChatGPT dark theme, confirm the native header controls retain matching colors and hover treatment. Light-theme placement, sizing, Share-button non-overlap, and SPA remounting were verified live on 2026-07-22.
