## Review Backlog

### Ticket 3 follow-up (ChatGPT adapter) — manual verification & edge cases

- [ ] [VERIFY] Load-unpacked on a long/virtualized live conversation: confirm `autoScrollToLoad` pulls in all lazy-rendered older turns, the extracted `Conversation` captures the full history in order, and a scroll that never settles fails loud (`ExtractionError`). Deferred — needs a logged-in browser session; the auto-scroll path has no unit coverage (fixtures skip the live path).

### Bulk panel "Load more" follow-up

- [ ] [VERIFY] Load-unpacked on a virtualized history sidebar AND a project home page: open the bulk panel, click "Load more" once, and confirm `findScrollableAncestor` targets the real scroll container so previously-hidden conversations appear and become selectable (existing selections preserved), the button settles into its disabled done state when nothing new remains, and a scroll that never settles fails loud (`ExtractionError`) into the status line. Deferred — the scroll-container discovery cannot be verified against live markup without a logged-in browser session (mirrors the `autoScrollToLoad` VERIFY above).
- [ ] [VERIFY] Live smoke-check "Load more" on a long history sidebar and a project home: the checklist must contain the FULL list (top rows included, no gaps in the middle) and settle into the disabled done state. The recycling-virtualizer correctness gap is now closed in code — `loadMoreConversations` / `loadMoreProjectConversations` step one viewport per round (`stepDown`) and accumulate the `SidebarConversation` list across every window (unit-covered in `test/adapters/chatgpt/load-more.test.ts`, incl. a spacer-height recycling model), so rows trimmed off the top AND rows in windows a jump-to-bottom would skip are no longer dropped. This remaining item is only a live-markup confirmation, not an open risk. Deferred — needs a logged-in session with a long enough history.
- [ ] [VERIFY] Confirm ChatGPT sidebar / project conversation titles render synchronously with their link anchors. `collectConversations` freezes each row's title at first-sight (`acc.has(id)` skips re-visits); since rows are now captured mid-scroll, a title still hydrating when its anchor first passes through the viewport would stick as the `'ChatGPT conversation'` fallback. Low confidence — `aria-label` titles are typically present synchronously (Claude review P3, conf 45). If observed live, upgrade a stored fallback title when a later round supplies a non-empty one. Deferred — needs a logged-in session.

### Header-blend buttons follow-up

- [ ] [VERIFY] In ChatGPT dark theme, confirm the native header controls retain matching colors and hover treatment. Light-theme placement, sizing, Share-button non-overlap, and SPA remounting were verified live on 2026-07-22.
