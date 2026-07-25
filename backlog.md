# Backlog

Design: `docs/design/chatgpt-conversation-backup.md`. v1 tickets below are vertical slices in
dependency order; blocked items stay invisible to `next-tasks` until their `*(blocked by: ...)*`
marker is removed by hand once the blocking ticket lands.

## Tooling & static analysis

> Goal: deepen mechanical enforcement of the golden principles (esp. #1 local-only) beyond the
> regex tripwire, and catch extension-specific and type-level defects in CI.

- [ ] [HARNESS] Add `addons-linter` (web-ext lint) as a CI step — validates the MV3 manifest and flags extension-unsafe patterns (`eval`, remote scripts, over-broad permissions). *(deferred: addons-linter is Firefox/AMO-oriented — on our Chrome-only MV3 manifest it only emits Firefox false-positives (`ADDON_ID_REQUIRED` gecko id, `gecko/data_collection_permissions`). No real Chrome value now; static analysis is covered by CodeQL + type-checked eslint + the privacy gate. Revisit if Firefox support is ever added.)*

## Next (roadmap — not v1)

- [ ] Gemini adapter (reuse core model + exporters via ConversationAdapter)
- [ ] Claude adapter: bulk/sidebar export (`listConversations` / `openConversation` /
      `loadMoreConversations`) *(blocked by: needs its own live-DOM session — the sidebar's list
      structure, its scroll port, and whether it pages from the server were never measured; the
      2026-07-25 session covered only the conversation view)*
- [ ] Claude adapter: Projects track (`matchesProject` + the project bulk members)
      *(blocked by: Claude's project routes and project-home list markup are unmeasured — same
      session gap as the sidebar item above)*
