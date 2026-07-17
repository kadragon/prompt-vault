# Changelog

## Unreleased

- [done] i18n message-key safety test — `test/i18n/message-keys.test.ts` asserts every key resolved through `m('...')` in `src/strings.ts` exists in both `public/_locales/{en,ko}/messages.json` with matching placeholder sets, turning a silent-empty-string key typo (AGENTS.md #4 fail-loud regression) into a red test. Test-only; no runtime change (2026-07-17)

- [done] i18n (Korean UI strings) — native `chrome.i18n` localization: message catalog in `public/_locales/{en,ko}/messages.json`, `src/strings.ts` now resolves every user-facing string via `chrome.i18n.getMessage()` (public API unchanged), `default_locale: 'en'` in the manifest; locale follows the browser UI language. A node-env vitest shim (`test/setup/chrome-i18n.ts`) backs the English catalog for tests. No new permissions or network calls (2026-07-17)

- [done] Additional export formats — JSON & HTML — two new provider-agnostic exporters (`src/export/json.ts`, `src/export/html.ts`) consuming the normalized `Conversation` model; JSON is a deterministic round-trippable model dump, HTML is a self-contained document showing each message's Markdown verbatim in an HTML-escaped `<pre>` block; wired into the headless saver (`ExportFormat` now `md|pdf|json|html`) and the header toolbar (four icon buttons). No new permissions or network calls (2026-07-17)

- [done] Bulk download — export core slice — headless `saveConversation(conversation, format, now, doc?)` and a provider-agnostic sequential `bulkExport` orchestrator (per-item fail-loud into a `{ total, succeeded, failed[] }` summary, throttled between saves); `runExport` now delegates its produce+save step to the shared saver. The design's "forward hook" for bulk export; live sidebar enumeration + navigation remain a deferred, login-session-only follow-up (2026-07-17)

- [done] Markdown export serialization edge-case fixes — `<div>`/`<section>` wrapper block children in `<li>` no longer flatten onto the marker line (and a wrapper whose first block child is a nested list no longer collides markers); emphasis/strikethrough delimiters straddling an inline wrapper (`_<span>x</span>_`) now escape via cross-boundary flanking classification, without over-escaping an intraword `_` next to inline markup (2026-07-17)

- [done] Blend download buttons into the ChatGPT header — the `MD`/`PDF` buttons now mount inside ChatGPT's native header action bar (styled like the Share button, auto light/dark) instead of a fixed overlay that covered Share; falls back to a non-overlapping bottom-right overlay if the header is absent (2026-07-17)

- [done] html-to-markdown serialization & escape fixes — block content in `<li>` (nested code/paragraphs/`<ol start>`/text-after-list), literal-backslash-first escaping, CommonMark-flanking emphasis/strikethrough escaping, and GFM `<table>` support (2026-07-17)

- [done] Fail-loud empty-conversation guard — `runExport` throws `ExtractionError` (visible alert, no download) on a zero-message `Conversation`, defense-in-depth over adapter-level guards for both MD and PDF paths (2026-07-17)

- [done] Markdown escaping — escape Markdown-significant characters in `html-to-markdown` text nodes and the `toMarkdown` title so literal text (`# not a heading`, `[1]`, `1.`) no longer round-trips into structure (2026-07-17)

- [done] PDF export — PDF button saves the conversation as a selectable-text PDF (embedded Jetendard CJK monospace font, direct download, no print dialog) (2026-07-17)

- [done] Markdown export — Download button saves the conversation as a local `.md` file (2026-07-17)

- [done] Core Conversation model & ChatGPT adapter (centralized selectors, auto-scroll, HTML→Markdown, fail-loud) with fixture tests (2026-07-17)
- [done] eslint type-checked lint (recommendedTypeChecked, projectService) (2026-07-17)
- [done] CodeQL code scanning (javascript-typescript, security-extended) on push/PR (2026-07-17)
- [done] Privacy invariant gate — no-external-network test over src/adapters|export|content (2026-07-17)
- [done] Scaffold & MV3 skeleton (2026-07-17)
