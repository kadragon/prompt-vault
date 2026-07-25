# Backlog

Design: `docs/design/chatgpt-conversation-backup.md`. v1 tickets below are vertical slices in
dependency order; blocked items stay invisible to `next-tasks` until their `*(blocked by: ...)*`
marker is removed by hand once the blocking ticket lands.

## Tooling & static analysis

> Goal: deepen mechanical enforcement of the golden principles (esp. #1 local-only) beyond the
> regex tripwire, and catch extension-specific and type-level defects in CI.

- [ ] [HARNESS] Add `addons-linter` (web-ext lint) as a CI step — validates the MV3 manifest and flags extension-unsafe patterns (`eval`, remote scripts, over-broad permissions). *(deferred: addons-linter is Firefox/AMO-oriented — on our Chrome-only MV3 manifest it only emits Firefox false-positives (`ADDON_ID_REQUIRED` gecko id, `gecko/data_collection_permissions`). No real Chrome value now; static analysis is covered by CodeQL + type-checked eslint + the privacy gate. Revisit if Firefox support is ever added.)*

## Extraction completeness

- [ ] [FEAT] Use Claude's `aria-setsize` as a completeness oracle. One virtualizer row was dumped in
      full on 2026-07-25 and wrapped its message in `div[role="article"]` carrying `aria-setsize="56"`
      and `aria-posinset="51"` (the row whose `data-index` was 50) — the `aria-setsize` value matched
      the observed row count exactly (see `docs/live-dom-verification.md`). If it holds generally, it
      is a declared total and `collected !== aria-setsize` would catch turns missing off the trailing
      end, which the contiguity check cannot — that check now covers the leading end but nothing
      bounds the tail. Would also give the walk a real termination condition instead of the
      settle-rounds heuristic. Verify first, and treat none of it as established: presence on every
      row, stability mid-stream, and whether it counts rows or messages (one measured row held four
      assistant blocks, so the two are not interchangeable).

## Next (roadmap — not v1)

- [ ] Gemini adapter (reuse core model + exporters via ConversationAdapter)
- [ ] Claude adapter: bulk/sidebar export (`listConversations` / `openConversation` /
      `loadMoreConversations`) *(blocked by: needs its own live-DOM session — the sidebar's list
      structure, its scroll port, and whether it pages from the server were never measured; the
      2026-07-25 session covered only the conversation view)*
- [ ] Claude adapter: Projects track (`matchesProject` + the project bulk members)
      *(blocked by: Claude's project routes and project-home list markup are unmeasured — same
      session gap as the sidebar item above)*
