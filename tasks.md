# Review Backlog

### Ticket 1 follow-up (scaffold) — manual verification

- [ ] [VERIFY] Load-unpacked on live chatgpt.com: confirm the Download button appears top-right only on `/c/<id>` pages, toggles correctly on SPA navigation (sidebar conversation clicks, back/forward) via the isolated-world `location` polling in `src/content/index.ts`, and that ChatGPT's page CSP does not interfere with the content script. Deferred from ticket 1 — needs a logged-in browser session, which the agent cannot drive.

### Ticket 3 follow-up (ChatGPT adapter) — manual verification & edge cases

- [ ] [VERIFY] Load-unpacked on a long/virtualized live conversation: confirm `autoScrollToLoad` pulls in all lazy-rendered older turns, the extracted `Conversation` captures the full history in order, and a scroll that never settles fails loud (`ExtractionError`). Deferred — needs a logged-in browser session; the auto-scroll path has no unit coverage (fixtures skip the live path).
- [ ] [FIX] `html-to-markdown` list edge cases: block content inside `<li>` is flattened through the inline path — a nested `<pre>` collapses to inline code (and its header language label leaks into text), multiple `<p>` in one `<li>` concatenate without a break, `<ol start="N">` is ignored, and text following a nested list in the same `<li>` merges onto the parent line. Not exercised by current fixtures; capture a fixture that nests a code block in a list item, then handle block children in `serializeList`. *(from dev-review: Codex P2, Claude P3)*
- [ ] [FIX] `html-to-markdown` does not escape Markdown-significant characters in plain text nodes, so assistant text like `# not a heading` or `1. not a list` becomes structural Markdown on export. Escape leading `#`/`>`/`-`/`*`/digit-dot and inline `` ` ``/`[`/`]` in text nodes while preserving delimiters generated for real HTML formatting. Consider handling alongside the Markdown exporter (ticket 4). *(from dev-review: Codex P2)*
- [ ] [FEAT] `html-to-markdown` best-effort table support: assistant `<table>` currently serializes to concatenated inline text (no rows/separators) and is unrecoverable downstream since exporters only see the normalized string. Serialize `<thead>/<tbody>/<tr>/<td>` into a GFM table here. Not in current fixtures. *(from dev-review: Codex P2)*
