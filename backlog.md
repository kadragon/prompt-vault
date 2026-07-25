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

## Extraction completeness

- [ ] [FEAT] *(blocked by: needs a live session capturing the markup of a conversation mid-response — see `docs/live-dom-verification.md`)*
      Give the Claude walk a real termination condition — one that can tell "the newest turn
      stopped growing" from "the newest turn is off-screen". PR #36 established that
      `aria-setsize` cannot do this on its own: the walk collects the bottom turn as a fragment,
      the virtualizer recycles that row away, and every "is it complete / has it gone quiet?"
      test then passes at the top of the conversation while the response is still streaming
      (measured: early exit at round 17 exporting a 4-character fragment vs 32 rounds exporting
      the full answer — see `docs/live-dom-verification.md` → "a declared total is an oracle, not
      a termination condition"). Today the walk therefore runs both passes to their scroll ends,
      which is correct but pays a full second traversal on every export. A fix needs a
      **stream-completion signal** — whatever Claude renders while generating (a stop button, an
      `aria-busy`, a streaming class on the turn) — and none of it has been measured, so it must
      not be guessed at (AGENTS.md #5). Note the same signal would also improve on today's
      behavior at the bottom, where the walk stops on scroll-settle regardless of whether the
      last turn is still growing.

## Next (roadmap — not v1)

- [ ] *(blocked by: needs its own live-DOM session — the sidebar's list structure, its scroll port, and whether it pages from the server were never measured; the 2026-07-25 session covered only the conversation view)*
      Claude adapter: bulk/sidebar export (`listConversations` / `openConversation` /
      `loadMoreConversations`)
- [ ] *(blocked by: Claude's project routes and project-home list markup are unmeasured — same session gap as the sidebar item above)*
      Claude adapter: Projects track (`matchesProject` + the project bulk members)
- [ ] *(blocked by: needs its own live-DOM session — only the conversation view was measured on 2026-07-25; the sidebar was seen in passing (33 `[data-test-id="conversation"]` anchors in their own `infinite-scroller`) but its paging shape, scroll port, and whether it loads from the server were never measured)*
      Gemini adapter: bulk/sidebar export (`listConversations` / `openConversation` /
      `loadMoreConversations`)
- [ ] *(blocked by: Gemini's Gems and project routes and their list markup are unmeasured — `matches` deliberately excludes them, so those pages currently mount nothing)*
      Gemini adapter: Gems / Projects track (`matchesProject` + the project bulk members)
