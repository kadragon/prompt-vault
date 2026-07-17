## Review Backlog

### Ticket 1 follow-up (scaffold) — manual verification

- [ ] [VERIFY] Load-unpacked on live chatgpt.com: confirm the Download button appears top-right only on `/c/<id>` pages, toggles correctly on SPA navigation (sidebar conversation clicks, back/forward) via the isolated-world `location` polling in `src/content/index.ts`, and that ChatGPT's page CSP does not interfere with the content script. Deferred from ticket 1 — needs a logged-in browser session, which the agent cannot drive.

### Ticket 3 follow-up (ChatGPT adapter) — manual verification & edge cases

- [ ] [VERIFY] Load-unpacked on a long/virtualized live conversation: confirm `autoScrollToLoad` pulls in all lazy-rendered older turns, the extracted `Conversation` captures the full history in order, and a scroll that never settles fails loud (`ExtractionError`). Deferred — needs a logged-in browser session; the auto-scroll path has no unit coverage (fixtures skip the live path).

### Ticket 5 follow-up (PDF export) — manual verification

- [ ] [VERIFY] Load-unpacked on a live logged-in ChatGPT conversation (incl. a Korean one with a fenced code block): confirm both `MD` and `PDF` buttons mount top-right; the `PDF` button downloads directly with no print dialog; the opened PDF has selectable text, **Korean/CJK glyphs actually rasterize via the embedded Jetendard font (no tofu)**, and code blocks render monospace/boxed. Deferred — needs a logged-in browser session the agent cannot drive; automated coverage stops at the pdfmake document-definition level per the design.

