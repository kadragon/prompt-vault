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

- [ ] *(blocked by: needs a live-DOM session on an account holding a project reachable at the bare `/project/<id>` route — the 2026-08-10 session only exercised `/cowork/project/<id>`)*
      [FIX] Measure the `/project/<id>` project-home family. `PROJECT_PATHS`
      (`src/adapters/claude/matches.ts`) advertises it as supported, but nothing has been
      measured there — including whether its list is the same `data-cds` table. Until it is,
      any attribute pinning of `selectors.projectTable` would rest on an unmeasured assumption
      for half the supported routes (AGENTS.md #5).

## Review Backlog

### QA pass on the `/recents` bulk track + empty-project fix (2026-08-11)

> Non-blocking findings from the independent QA of the sprint that shipped the Claude `/recents`
> bulk track. None held the PR; each is either a pre-existing gap the sprint made visible or a
> limit that needs a measurement session to close.

- [ ] [TEST] The bulk-export `alert` branches are untested on all three tracks —
      `EXPORT_NO_ADAPTER_MESSAGE` / `BULK_UNSUPPORTED_MESSAGE` in `openBulkExport`,
      `openProjectBulkExport` and `openRecentsBulkExport` (`src/content/mount.ts`). No test
      references either constant. One item, all three tracks; needs `alert` stubbing the file
      does not do today.
- [ ] [CONSTRAINT] Stamp the shared `CONTAINER_ID` with its track. `test/content/mount.test.ts`
      pins the `/chat/<id>` → `/recents` → project-home hop, but it performs the `removeButtons`
      call itself, so it pins the bootstrap's sequence rather than `syncButtons`' self-sufficiency:
      dropping the removal at `src/content/index.ts` would leave the test green while a stale
      track's trigger is re-positioned into the new page's mount. A `data-track` attribute makes
      the invariant structural.
- [ ] *(blocked by: needs the same `/project/<id>` live-DOM session as the item above)*
      [FIX] A Claude project list rendered outside `<main>` would read as `[]` rather than failing
      loud. `listProjectConversations` scopes its stranded-link probe to `main a[href^="/chat/"]`
      because the app shell's `aside` carries up to 20 recent-chat anchors matching the same
      selector. `projectTable` (`main table`) has always carried that assumption, so this is not a
      new one — but no measurement would have seen links outside `main`, and `/project/<id>` is
      unmeasured entirely.
- [ ] [TEST] `recentsToolbarMount`'s fixture does not match the measured DOM: the comment records
      the table's parent as a plain `div` (docs/live-dom-verification.md → 2026-08-11), while
      `test/adapters/claude/recents.test.ts` nests the table directly in `<main>`. The test pins
      the fixture's shape rather than the measured one.
- [ ] [FEAT] Claude sets neither `projectToolbarButtonClass` nor `recentsToolbarButtonClass`, so
      both native list triggers render as unstyled default browser buttons — the conversation
      toolbar gets `toolbarButtonClass`, these do not. Pre-existing; a `product-evaluator` item
      before a Web Store release.
- [ ] [FIX] The `/recents` walk aborts the whole enumeration when a row transiently renders with
      no anchor, because it re-enters `listRecentsConversations` each round. That is the fail-loud
      direction and matches the row contract, but it is more brittle than the sidebar loader, which
      skips unreadable anchors. Revisit if a paging `/recents` is ever observed.
- [ ] *(blocked by: needs an account holding zero conversations — the measuring account holds 26)*
      [FIX] `/recents` on a brand-new account takes the loud branch, so a user with no
      conversations could be shown a markup-drift error instead of an empty state. Unlike the
      project track there is no measured shell marker for `/recents` to separate the two.

### PR #61 (Claude navigation/stream failure modes, 2026-08-10)

*(No open items — the sidebar-recycling `[FIX]` was closed 2026-08-10 by measurement rather than by
a change: the sidebar does not page at all, so the mid-walk reveal it guarded against cannot occur.
The larger hazard that measurement exposed is filed above.)*

## Next (roadmap — not v1)

- [ ] Gemini adapter: bulk/sidebar export (`listConversations` / `openConversation` /
      `loadMoreConversations`). Unblocked 2026-08-10 — the sidebar's paging shape, scroll port and
      identity are now measured: page size **20**, append-only (no recycling), every page landing
      within one 1500 ms round, and a 1:1 item↔anchor mapping (93 items, 93 distinct `/app/<16-hex>`
      ids, 0 anchors outside a `[data-test-id="conversation"]`). Two implementation constraints
      from that session: the sidebar's `infinite-scroller` carries **no** `data-test-id` (resolve it
      by containment, as Claude's `aside` is), and with the sidebar **collapsed** the anchors are
      absent from the document entirely. See docs/live-dom-verification.md → Gemini → 2026-08-10.
- [ ] *(blocked by: Gemini Notebooks list markup is unmeasured — the measuring account has zero notebooks, so the sidebar section renders only its create button)*
      Gemini adapter: Notebooks track (`matchesProject` + the project bulk members). Narrowed
      2026-08-10: the **Gems half was dropped as not-applicable** — `/gem/<id>` is a Gem-scoped new
      chat screen (0 `div.conversation-container`, 0 `a[href^="/app/"]`, an `empty-disclaimer`), not
      a home listing that Gem's conversations, so there is no member list to enumerate. Notebooks
      (`[data-test-id="notebooks-expandable-section"]`, `/notebooks/create`, `project-sidenav-list`)
      is Gemini's actual project analogue and is what this item now covers.
