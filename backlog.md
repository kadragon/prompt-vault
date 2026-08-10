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

## Claude adapter follow-ups (PR #58 review, 2026-08-10)

> Findings from the PR #58 panel that were out of scope for that PR. The route/locale defects
> themselves were fixed there; these are the parts that need a live-DOM session or a separate
> behaviour decision.

- [ ] *(blocked by: needs a live-DOM session — the 2026-08-09 measurement recorded only the localized `aria-label`, so no locale-independent handle is attested)*
      [FIX] Measure a stable Claude sidebar handle (nav landmark or data attribute) and pin
      `selectors.sidebar` to it. PR #58 dropped the Korean `aria-label` and narrows `aside` by
      chat-link containment, which is derived from the measurement rather than measured as
      unique. Capture an English-locale fixture in the same session.
- [ ] *(blocked by: needs a live-DOM session — no measurement says what a Claude project home renders before its conversation table hydrates, or what an artifact card looks like across kinds)*
      [FIX] Anchor `projectTable` / `artifactTitle` / `artifactKind` on measured attributes.
      The artifact labels are Tailwind utility tokens today, so a second `text-xs line-clamp-1`
      node inside a card (a timestamp, a version badge) fails the whole conversation export.

## Next (roadmap — not v1)

- [ ] *(blocked by: needs its own live-DOM session — only the conversation view was measured on 2026-07-25; the sidebar was seen in passing (33 `[data-test-id="conversation"]` anchors in their own `infinite-scroller`) but its paging shape, scroll port, and whether it loads from the server were never measured)*
      Gemini adapter: bulk/sidebar export (`listConversations` / `openConversation` /
      `loadMoreConversations`)
- [ ] *(blocked by: Gemini's Gems and project routes and their list markup are unmeasured — `matches` deliberately excludes them, so those pages currently mount nothing)*
      Gemini adapter: Gems / Projects track (`matchesProject` + the project bulk members)
