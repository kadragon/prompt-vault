# Backlog

Design: `docs/design/chatgpt-conversation-backup.md`. v1 tickets below are vertical slices in
dependency order; blocked items stay invisible to `next-tasks` until their `*(blocked by: ...)*`
marker is removed by hand once the blocking ticket lands.

A `*(blocked by: ...)*` / `*(deferred: ...)*` marker MUST sit on the item's own `- [ ]` line (here
and in `tasks.md`). The picker tokenizes checkboxes line by line, so a marker pushed onto a
continuation line is invisible to it and the blocked item is offered as actionable work.

## Tooling & static analysis

> Goal: deepen mechanical enforcement of the golden principles (esp. #1 local-only) beyond the
> regex tripwire, and catch extension-specific and type-level defects in CI.

- [ ] [HARNESS] Add `addons-linter` (web-ext lint) as a CI step — validates the MV3 manifest and flags extension-unsafe patterns (`eval`, remote scripts, over-broad permissions). *(deferred: addons-linter is Firefox/AMO-oriented — on our Chrome-only MV3 manifest it only emits Firefox false-positives (`ADDON_ID_REQUIRED` gecko id, `gecko/data_collection_permissions`). No real Chrome value now; static analysis is covered by CodeQL + type-checked eslint + the privacy gate. Revisit if Firefox support is ever added.)*

## Next (roadmap — not v1)

- [ ] *(blocked by: needs its own live-DOM session — only the conversation view was measured on 2026-07-25; the sidebar was seen in passing (33 `[data-test-id="conversation"]` anchors in their own `infinite-scroller`) but its paging shape, scroll port, and whether it loads from the server were never measured)*
      Gemini adapter: bulk/sidebar export (`listConversations` / `openConversation` /
      `loadMoreConversations`)
- [ ] *(blocked by: Gemini's Gems and project routes and their list markup are unmeasured — `matches` deliberately excludes them, so those pages currently mount nothing)*
      Gemini adapter: Gems / Projects track (`matchesProject` + the project bulk members)
