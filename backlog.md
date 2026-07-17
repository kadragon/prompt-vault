# Backlog

Design: `docs/design/chatgpt-conversation-backup.md`. v1 tickets below are vertical slices in
dependency order; blocked items stay invisible to `next-tasks` until their `*(blocked by: ...)*`
marker is removed by hand once the blocking ticket lands.

## 3 — Core model & ChatGPT adapter

> Goal: extract a full conversation from the live page into the normalized model.
> Done-when: `Conversation`/`Message` types defined; ChatGPT adapter with centralized selectors auto-scrolls to load virtualized messages, extracts in order, and fails loud (visible error) on empty/malformed output; fixture tests pass.

- [ ] [FEAT] Conversation/Message model (src/core) + ChatGPT adapter (selectors, auto-scroll full load, fail-loud) with HTML fixture tests

## 4 — Markdown export

> Goal: first real user value — download the current conversation as Markdown.
> Done-when: `src/export/markdown.ts` is a pure Conversation→string preserving role/order/fenced code blocks/lists/bold-italic/links (images as links, tables best-effort), deterministic; the button's Markdown action saves `chatgpt-{safe-title}-{yyyymmdd}.md` locally.

- [ ] [FEAT] Markdown exporter + wire button Markdown action to local download *(blocked by: 3-core-adapter)*

## 5 — PDF export

> Goal: download the current conversation as a selectable-text PDF, with no print dialog (bulk-ready).
> Done-when: `src/export/pdf.ts` builds a pdfmake document definition from the model and downloads a PDF directly; code blocks render as monospace; Korean (CJK) glyphs render via an embedded font; the button's PDF action works.

- [ ] [FEAT] pdfmake PDF exporter (CJK font) + wire button PDF action to direct download *(blocked by: 3-core-adapter)*

## Tooling & static analysis

> Goal: deepen mechanical enforcement of the golden principles (esp. #1 local-only) beyond the
> regex tripwire, and catch extension-specific and type-level defects in CI.

- [ ] [HARNESS] Add CodeQL (GitHub code scanning) JS/TS workflow — data-flow analysis to catch conversation data reaching a real network sink (semantic-escape resistance the regex gate lacks); wire into CI on push/PR.
- [ ] [HARNESS] Add `addons-linter` (web-ext lint) as a CI step — validates the MV3 manifest and flags extension-unsafe patterns (`eval`, remote scripts, over-broad permissions).
- [ ] [HARNESS] Upgrade eslint from `recommended` to `recommendedTypeChecked` (type-aware lint: floating promises, unsafe `any`); wire `parserOptions.project` and confirm `npm run lint` stays green.

## Next (roadmap — not v1)

- [ ] Gemini adapter (reuse core model + exporters via ConversationAdapter)
- [ ] Claude adapter (reuse core model + exporters via ConversationAdapter)
- [ ] Bulk download — navigate across conversations, auto-save many (export layer already programmatic)

## Someday

- [ ] Additional formats (JSON, HTML)
- [ ] i18n (Korean UI strings)
- [ ] Chrome Web Store submission (icons, listing, privacy policy, review)
