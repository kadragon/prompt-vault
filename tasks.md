## Review Backlog

### Ticket 3 follow-up (ChatGPT adapter) — manual verification & edge cases

- [ ] [VERIFY] Load-unpacked on a long/virtualized live conversation: confirm `autoScrollToLoad` pulls in all lazy-rendered older turns, the extracted `Conversation` captures the full history in order, and a scroll that never settles fails loud (`ExtractionError`). Deferred — needs a logged-in browser session; the auto-scroll path has no unit coverage (fixtures skip the live path).

### Bulk panel "Load more" follow-up

- [ ] [VERIFY] Load-unpacked on a virtualized history sidebar AND a project home page: open the bulk panel, click "Load more" once, and confirm `findScrollableAncestor` targets the real scroll container so previously-hidden conversations appear and become selectable (existing selections preserved), the button settles into its disabled done state when nothing new remains, and a scroll that never settles fails loud (`ExtractionError`) into the status line. Deferred — the scroll-container discovery cannot be verified against live markup without a logged-in browser session (mirrors the `autoScrollToLoad` VERIFY above).

### Header-blend buttons follow-up

- [ ] [VERIFY] In ChatGPT dark theme, confirm the native header controls retain matching colors and hover treatment. Light-theme placement, sizing, Share-button non-overlap, and SPA remounting were verified live on 2026-07-22.
