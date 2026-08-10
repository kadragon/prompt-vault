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

- [ ] [FIX] Claude bulk export reaches at most the 20 rows the sidebar renders, whatever the
      account size. Measured 2026-08-10: the Recents list is UI-capped at 20 and does not page
      (12 scroll rounds, `scrollHeight` constant at 760 px, nothing trimmed), so
      `loadMoreConversations` cannot surface anything below it — on the 25-conversation account
      measured, 5 conversations are already unreachable, silently. The full list lives at
      `/recents` as a `table[data-cds="Table"]` behind the sidebar's "모두 보기 / View all"
      control. Needs a route decision (move the bulk track to `/recents`), not a selector, plus
      its own measurement of whether `/recents` pages at larger scale — 25 rows fit without
      crossing a page boundary. See docs/live-dom-verification.md → Claude → 2026-08-10.
- [ ] [FIX] The exported Claude artifact kind is localized, so the same artifact exports
      differently per UI language. Measured 2026-08-10 on a ko-KR account: `문서 · MD`,
      `코드 · JSX`. `artifactMarkers` (`src/adapters/claude/index.ts`) builds
      `[Artifact: <title> (<kind>)]` and that string reaches Markdown and JSON verbatim
      (`src/export/markdown.ts`, `src/export/json.ts`). The card exposes no machine-readable kind
      — no `data-*` exists on it at all — so this needs a decision (derive from the trailing
      token, or drop the kind) rather than a different selector.

## Review Backlog

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
