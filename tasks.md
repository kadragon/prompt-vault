# Review Backlog

### Ticket 1 follow-up (scaffold) — manual verification

- [ ] [VERIFY] Load-unpacked on live chatgpt.com: confirm the Download button appears top-right only on `/c/<id>` pages, toggles correctly on SPA navigation (sidebar conversation clicks, back/forward) via the isolated-world `location` polling in `src/content/index.ts`, and that ChatGPT's page CSP does not interfere with the content script. Deferred from ticket 1 — needs a logged-in browser session, which the agent cannot drive.

### Ticket 3 follow-up (ChatGPT adapter) — manual verification & edge cases

- [ ] [VERIFY] Load-unpacked on a long/virtualized live conversation: confirm `autoScrollToLoad` pulls in all lazy-rendered older turns, the extracted `Conversation` captures the full history in order, and a scroll that never settles fails loud (`ExtractionError`). Deferred — needs a logged-in browser session; the auto-scroll path has no unit coverage (fixtures skip the live path).
- [ ] [FIX] `html-to-markdown` list edge cases: block content inside `<li>` is flattened through the inline path — a nested `<pre>` collapses to inline code (and its header language label leaks into text), multiple `<p>` in one `<li>` concatenate without a break, `<ol start="N">` is ignored, and text following a nested list in the same `<li>` merges onto the parent line. Not exercised by current fixtures; capture a fixture that nests a code block in a list item, then handle block children in `serializeList`. *(from dev-review: Codex P2, Claude P3)*
- [ ] [FIX] `html-to-markdown` / `markdown.ts` do not escape a literal backslash in plain text, so assistant text like `a\*b` renders `a*b` and `\[` becomes `\\[` (doubled). A canonical escaper escapes `\` first. Affects LaTeX/regex/Windows-path text. Deferred from the escape bundle — low real-world risk. *(from QA of fix/markdown-escape)*
- [ ] [FEAT] `html-to-markdown` best-effort table support: assistant `<table>` currently serializes to concatenated inline text (no rows/separators) and is unrecoverable downstream since exporters only see the normalized string. Serialize `<thead>/<tbody>/<tr>/<td>` into a GFM table here. Not in current fixtures. *(from dev-review: Codex P2)*

### Ticket 5 follow-up (PDF export) — manual verification

- [ ] [VERIFY] Load-unpacked on a live logged-in ChatGPT conversation (incl. a Korean one with a fenced code block): confirm both `MD` and `PDF` buttons mount top-right; the `PDF` button downloads directly with no print dialog; the opened PDF has selectable text, **Korean/CJK glyphs actually rasterize via the embedded Jetendard font (no tofu)**, and code blocks render monospace/boxed. Deferred — needs a logged-in browser session the agent cannot drive; automated coverage stops at the pdfmake document-definition level per the design.

### Ticket 4 follow-up (Markdown export) — review findings

- [ ] [FIX] `runExport` delegates the fail-loud/empty guard entirely to the adapter: `toMarkdown` renders a title-only document for a zero-message `Conversation`, so an adapter that returned empty without throwing `ExtractionError` would download a near-empty `.md` (Golden Principle #4 gap). Add a defense-in-depth guard (treat `messages.length === 0` as fail-loud) in `runExport`. Not a live bug — the ChatGPT adapter throws. *(from dev-review: Claude P3, confidence 30)*
