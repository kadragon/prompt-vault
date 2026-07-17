# Backlog

Design: `docs/design/chatgpt-conversation-backup.md`. v1 tickets below are vertical slices in
dependency order; blocked items stay invisible to `next-tasks` until their `*(blocked by: ...)*`
marker is removed by hand once the blocking ticket lands.

## 2 — Privacy invariant gate

> Goal: mechanically enforce local-only (golden principle) before export/adapter code exists, so all later code is checked.
> Done-when: an automated test/grep gate fails if any `fetch`/`XMLHttpRequest`/`sendBeacon` to an external origin appears in `src/adapters`, `src/export`, or `src/content`.

- [ ] [CONSTRAINT] Add no-external-network test/grep gate over src/adapters|export|content

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

## Next (roadmap — not v1)

- [ ] Gemini adapter (reuse core model + exporters via ConversationAdapter)
- [ ] Claude adapter (reuse core model + exporters via ConversationAdapter)
- [ ] Bulk download — navigate across conversations, auto-save many (export layer already programmatic)

## Someday

- [ ] Additional formats (JSON, HTML)
- [ ] i18n (Korean UI strings)
- [ ] Chrome Web Store submission (icons, listing, privacy policy, review)
