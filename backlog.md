# Backlog

Design: `docs/design/chatgpt-conversation-backup.md`. v1 tickets below are vertical slices in
dependency order; blocked items stay invisible to `next-tasks` until their `*(blocked by: ...)*`
marker is removed by hand once the blocking ticket lands.

## 4 — Markdown export

> Goal: first real user value — download the current conversation as Markdown.
> Done-when: `src/export/markdown.ts` is a pure Conversation→string preserving role/order/fenced code blocks/lists/bold-italic/links (images as links, tables best-effort), deterministic; the button's Markdown action saves `chatgpt-{safe-title}-{yyyymmdd}.md` locally.

- [ ] [FEAT] Markdown exporter + wire button Markdown action to local download

## 5 — PDF export

> Goal: download the current conversation as a selectable-text PDF, with no print dialog (bulk-ready).
> Done-when: `src/export/pdf.ts` builds a pdfmake document definition from the model and downloads a PDF directly; code blocks render as monospace; Korean (CJK) glyphs render via an embedded font; the button's PDF action works.

- [ ] [FEAT] pdfmake PDF exporter (CJK font) + wire button PDF action to direct download

## Tooling & static analysis

> Goal: deepen mechanical enforcement of the golden principles (esp. #1 local-only) beyond the
> regex tripwire, and catch extension-specific and type-level defects in CI.

- [ ] [HARNESS] Add `addons-linter` (web-ext lint) as a CI step — validates the MV3 manifest and flags extension-unsafe patterns (`eval`, remote scripts, over-broad permissions). *(deferred: addons-linter is Firefox/AMO-oriented — on our Chrome-only MV3 manifest it only emits Firefox false-positives (`ADDON_ID_REQUIRED` gecko id, `gecko/data_collection_permissions`). No real Chrome value now; static analysis is covered by CodeQL + type-checked eslint + the privacy gate. Revisit if Firefox support is ever added.)*

## Next (roadmap — not v1)

- [ ] Gemini adapter (reuse core model + exporters via ConversationAdapter)
- [ ] Claude adapter (reuse core model + exporters via ConversationAdapter)
- [ ] Bulk download — navigate across conversations, auto-save many (export layer already programmatic)

## Someday

- [ ] Additional formats (JSON, HTML)
- [ ] i18n (Korean UI strings)
- [ ] Chrome Web Store submission (icons, listing, privacy policy, review)
