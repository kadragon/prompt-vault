## Review Backlog

### i18n follow-up (chrome.i18n key safety)

- [ ] [TEST] `chrome.i18n.getMessage()` returns `""` (not a throw) for a missing/misspelled key, so a future key typo in `src/strings.ts` would silently ship an empty button label or empty fail-loud message — a regression against AGENTS.md #4 (fail loud). Not currently triggered (all keys match both catalogs). Add a test asserting every key referenced in `src/strings.ts` exists in `public/_locales/en/messages.json` **and** `ko/messages.json` with matching placeholder sets. (`src/strings.ts:6`, source: review; low-confidence 45, out-of-scope for the i18n feature PR #18)

### Ticket 1 follow-up (scaffold) — manual verification

- [ ] [VERIFY] Load-unpacked on live chatgpt.com: confirm the Download button appears top-right only on `/c/<id>` pages, toggles correctly on SPA navigation (sidebar conversation clicks, back/forward) via the isolated-world `location` polling in `src/content/index.ts`, and that ChatGPT's page CSP does not interfere with the content script. Deferred from ticket 1 — needs a logged-in browser session, which the agent cannot drive.

### Ticket 3 follow-up (ChatGPT adapter) — manual verification & edge cases

- [ ] [VERIFY] Load-unpacked on a long/virtualized live conversation: confirm `autoScrollToLoad` pulls in all lazy-rendered older turns, the extracted `Conversation` captures the full history in order, and a scroll that never settles fails loud (`ExtractionError`). Deferred — needs a logged-in browser session; the auto-scroll path has no unit coverage (fixtures skip the live path).

### Ticket 5 follow-up (PDF export) — manual verification

- [ ] [VERIFY] Load-unpacked on a live logged-in ChatGPT conversation (incl. a Korean one with a fenced code block): confirm both `MD` and `PDF` buttons mount top-right; the `PDF` button downloads directly with no print dialog; the opened PDF has selectable text, **Korean/CJK glyphs actually rasterize via the embedded Jetendard font (no tofu)**, and code blocks render monospace/boxed. Deferred — needs a logged-in browser session the agent cannot drive; automated coverage stops at the pdfmake document-definition level per the design.

### Header-blend buttons follow-up

- [ ] [VERIFY] Load-unpacked on a live logged-in ChatGPT conversation: confirm the `MD`/`PDF` buttons render inside `#conversation-header-actions` inline with (and no longer covering) the native Share button, match its size/hover in both light and dark themes, and re-appear correctly after SPA navigation between conversations. Deferred — needs a logged-in browser session; unit coverage stops at the DOM-injection structure (`test/content/mount.test.ts`), not live CSS blending.
