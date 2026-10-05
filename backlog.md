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

## Review Backlog

### PR #114 — queue cleanup harness follow-up (2026-10-05)

- [ ] [harness] Make `task_nodes.py prune-backlog` remove a selected multiline item's indented continuation block; this run removed only its three checkbox lines and left orphan prose. Add a regression preserving neighboring blocked items. *(blocked by: fix belongs to the external dev plugin repository, outside this sprint and repository scope)*

### PR #113 — live DOM measurement recording (2026-10-05)

- [ ] *(blocked by: needs a fresh per-row probe during Claude recents paging)* [doc] Classify the extra row in the intermediate 32-row / 30-link / 1-blank snapshot, or explicitly mark it unclassified. Counts alone do not establish that every anchorless row is the measured 1px blank row. (source: greptile) — docs/live-dom-verification.md:809 (introduced here)

### Store screenshot follow-ups (PR #65 review, 2026-08-11)

- [ ] *(blocked by: needs `--lang=en-US` on the capture browser, which is a user-scoped Playwright MCP config change — propose it, do not assume it)*
      [FIX] The English-listing `screenshot-03-claude-conversation.png` still shows Claude's
      native Share control as `공유`. Claude renders that string from `navigator.language`, which
      follows the OS UI language, so neither the `Accept-Language` reorder nor an account setting
      moves it — see the capture notes in `docs/store-listing.md`. Re-capture once the browser can
      be launched in English, or drop shot 3 from the English set rather than ship mixed-language
      product chrome.
- [ ] [FIX] Re-capture `screenshot-05-exported-pdf.png` (both locales) from a conversation containing `=>` and an inline-code run. *(deferred: authenticated headed browser + non-sensitive demo conversation required)*
      The two PDF rendering items it waited on landed in
      v1.10.3 (ligatures disabled, inline code styled), so this is now unblocked. The
      shipped capture uses Python/shell only, which keeps the caption honest but means the shot no
      longer exercises the two cases most likely to regress.

### QA pass on the `/recents` bulk track + empty-project fix (2026-08-11)

> Non-blocking findings from the independent QA of the sprint that shipped the Claude `/recents`
> bulk track. None held the PR; each is either a pre-existing gap the sprint made visible or a
> limit that needs a measurement session to close.

- [ ] *(blocked by: needs a live-DOM session on a project holding knowledge documents and zero conversations — the 2026-08-11 probe project held neither)*
      [VERIFY] Confirm what a Claude project with documents but no conversations renders. The
      adapter now decides emptiness from the absence of conversation links in `main` rather than
      the absence of a table, so it is correct either way — but whether such a project renders a
      document table at all is still unmeasured, and the answer would let the row contract be
      tightened.
- [ ] *(blocked by: needs a ja-JP or zh UI account — the measuring account is ko-KR only)*
      [VERIFY] Measure the artifact card's kind separator outside ko-KR. `artifactFormatToken`
      accepts U+00B7, U+30FB and U+2022 and passes any other shape through verbatim, so a different
      dot cannot break an export — but only U+00B7 is measured, and confirming the others would let
      the accepted set be narrowed back to what Claude actually renders.
- [ ] *(blocked by: needs an account holding zero conversations — the measuring account holds 26)*
      [FIX] `/recents` on a brand-new account takes the loud branch, so a user with no
      conversations could be shown a markup-drift error instead of an empty state. Unlike the
      project track there is no measured shell marker for `/recents` to separate the two.

### PR #61 (Claude navigation/stream failure modes, 2026-08-10)

*(No open items — the sidebar-recycling `[FIX]` was closed 2026-08-10 by measurement rather than by
a change: the sidebar does not page at all, so the mid-walk reveal it guarded against cannot occur.
The larger hazard that measurement exposed is filed above.)*

### QA pass on the Gemini bulk/sidebar track (2026-08-20)

> Non-blocking findings from the independent QA of the sprint that shipped Gemini's
> `listConversations` / `openConversation` / `loadMoreConversations`. The blocking finding — a
> stale render resolving `openConversation`, which would export the outgoing conversation's
> content under the target's name with no error — was fixed in that sprint, after a first
> attempt (a minimum dwell since the click) was shown to move the window rather than close it.
>
> Two items from this group are gone because the PR #71 review round fixed them rather than
> deferring them: the `pageParityGate` monotonic-growth item (an established page size is now
> never redefined, and a whole multiple of it counts as a page boundary) and the fast-path item
> (a changed signature must now hold still before it is accepted). That same round also split the
> parity verdict three ways — a first settled batch, which must define the size it would be tested
> against, now buys the longer dwell WITHOUT claiming the list is short, so `onIncomplete` is a
> narrower signal than the one those items describe.

- [ ] *(blocked by: cold/subframe row-vs-anchor hydration remains unmeasured; expanded paging on 2026-10-05 showed equal row/anchor counts at 52, 72, 92, and 112)*
      [FIX] A partially hydrated sidebar — rows attached, their inner `<a>` not yet — is
      indistinguishable from a collapsed one, so `assertSidebarExpanded` tells the user to open a
      sidebar that is already open. Wrong-but-recoverable (a retry succeeds) and never a silent
      empty list, so it violates no golden principle. Angular renders a component template
      atomically and the anchor lives inside the row template, so the window is likely sub-frame.
      Cheapest hardening if it turns out real: one `requestAnimationFrame` re-check before throwing.
- [ ] *(deferred: provider-wide exchange identity remains unverified; 2026-10-05 A/B/A revisits preserved ordered IDs across new nodes in two conversations, which is insufficient to guarantee identity)*
      [FIX] `openConversation` accepts an outgoing view that was destroyed and recreated as fresh
      nodes with a byte-identical id and text (QA's PROBE4: resolves at 455 ms with the outgoing
      content). Node identity proves a render *occurred*, not *which* conversation rendered.
      Recorded so the limit is on the record rather than rediscovered.

## ChatGPT app-shell follow-ups (2026-09-29)

> Left open by the sidebar/project/load-older batch; evidence in `docs/live-dom-verification.md`
> → 2026-09-29 "app-shell sidebar, project pages …".

- [ ] *(blocked by: needs a ChatGPT project holding more conversations than fit on its home page — the demo project has 8)* [VERIFY] Does a long project home list page or virtualize, and does `revealFromProjectHome` still find a target below the fold after returning home?
- [ ] *(deferred: no positive "no older turns" marker exists — the 2026-09-29 live session searched and found none; revisit only with new DOM evidence)* [debt] A conversation that never renders the "loading earlier messages" status still waits the full 6 s load-older dwell (the drift-safe variant was chosen on 2026-09-29); only a positive "no older turns" marker would let short conversations skip it — none was found.

## Next (roadmap — not v1)

- [ ] *(blocked by: Gemini Notebooks list markup is unmeasured — the measuring account has zero notebooks, so the sidebar section renders only its create button)*
      Gemini adapter: Notebooks track (`matchesProject` + the project bulk members). Narrowed
      2026-08-10: the **Gems half was dropped as not-applicable** — `/gem/<id>` is a Gem-scoped new
      chat screen (0 `div.conversation-container`, 0 `a[href^="/app/"]`, an `empty-disclaimer`), not
      a home listing that Gem's conversations, so there is no member list to enumerate. Notebooks
      (`[data-test-id="notebooks-expandable-section"]`, `/notebooks/create`, `project-sidenav-list`)
      is Gemini's actual project analogue and is what this item now covers.
