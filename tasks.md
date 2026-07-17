## Review Backlog

### Ticket 1 follow-up (scaffold) — manual verification

- [ ] [VERIFY] Load-unpacked on live chatgpt.com: confirm the Download button appears top-right only on `/c/<id>` pages, toggles correctly on SPA navigation (sidebar conversation clicks, back/forward) via the isolated-world `location` polling in `src/content/index.ts`, and that ChatGPT's page CSP does not interfere with the content script. Deferred from ticket 1 — needs a logged-in browser session, which the agent cannot drive.

### Ticket 3 follow-up (ChatGPT adapter) — manual verification & edge cases

- [ ] [VERIFY] Load-unpacked on a long/virtualized live conversation: confirm `autoScrollToLoad` pulls in all lazy-rendered older turns, the extracted `Conversation` captures the full history in order, and a scroll that never settles fails loud (`ExtractionError`). Deferred — needs a logged-in browser session; the auto-scroll path has no unit coverage (fixtures skip the live path).
- [ ] [FIX] `html-to-markdown` `serializeListItem`: a `<div>`/`<section>` wrapper directly inside `<li>` is not in `LIST_BLOCK_TAGS`, so block children (multiple `<p>`, a `<pre>`) wrapped in a div flatten onto the marker line. Route wrapper elements that have a block descendant (`hasBlockChild`) through block serialization. Pre-existing (predates the list-block-content fix); not exercised by current fixtures. *(from dev-review of PR #11: agy P2)*
- [ ] [FIX] `markdown-escape` flanking classification is node-local: literal emphasis delimiters that straddle an inline wrapper (e.g. `_<span>literal</span>_`) see per-text-node whitespace sentinels, so both underscores miss escaping and render as emphasis after export. Thread the previous/next visible flow character across inline-node boundaries into the flanking check. Pre-existing — the escaper was node-local before flanking too; not worsened by PR #11. *(from dev-review of PR #11: Codex P2)*

### Ticket 5 follow-up (PDF export) — manual verification

- [ ] [VERIFY] Load-unpacked on a live logged-in ChatGPT conversation (incl. a Korean one with a fenced code block): confirm both `MD` and `PDF` buttons mount top-right; the `PDF` button downloads directly with no print dialog; the opened PDF has selectable text, **Korean/CJK glyphs actually rasterize via the embedded Jetendard font (no tofu)**, and code blocks render monospace/boxed. Deferred — needs a logged-in browser session the agent cannot drive; automated coverage stops at the pdfmake document-definition level per the design.

