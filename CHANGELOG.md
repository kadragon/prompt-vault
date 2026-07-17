# Changelog

## Unreleased

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
