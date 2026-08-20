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
- [ ] *(blocked by: needs the same `/project/<id>` live-DOM session as the item above)*
      [FIX] A Claude project list rendered outside `<main>` would read as `[]` rather than failing
      loud. `listProjectConversations` scopes its stranded-link probe to `main a[href^="/chat/"]`
      because the app shell's `aside` carries up to 20 recent-chat anchors matching the same
      selector. `projectTable` (`main table`) has always carried that assumption, so this is not a
      new one — but no measurement would have seen links outside `main`, and `/project/<id>` is
      unmeasured entirely.
- [ ] *(deferred: `/recents` measured non-paging and fully rendered at 26 rows on 2026-08-11, so this loop barely turns; revisit if a paging `/recents` is observed)*
      [FIX] The `/recents` walk aborts the whole enumeration when a row transiently renders with
      no anchor, because it re-enters `listRecentsConversations` each round. That is the fail-loud
      direction and matches the row contract, but it is more brittle than the sidebar loader, which
      skips unreadable anchors.
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

- [ ] [FIX] `pageParityGate` in `src/adapters/gemini/index.ts` grows `pageSize` monotonically, so
      two 20-row pages landing inside one settled batch set it to 40 permanently and `onIncomplete`
      never fires again. Measured by QA: pages `[20, 20, 40, 20]` → no warning, against a control
      `[20, 20, 20]` → warning, for the same full-page terminal boundary. A lost "may be
      incomplete" warning, not a wrong list — the walk still terminates on a clamped static port,
      and the `onPageSize`-reports-only-a-matched-size rule keeps the bad size out of the cached
      `knownPageSize`. Candidate fixes: take the `min` of observed full batches, or refuse to let a
      batch redefine the size when it is an exact multiple of the current one.
- [ ] *(blocked by: the row-vs-anchor hydration order was not measured on 2026-08-10, so whether
      Gemini ever exposes the window is unknown)*
      [FIX] A partially hydrated sidebar — rows attached, their inner `<a>` not yet — is
      indistinguishable from a collapsed one, so `assertSidebarExpanded` tells the user to open a
      sidebar that is already open. Wrong-but-recoverable (a retry succeeds) and never a silent
      empty list, so it violates no golden principle. Angular renders a component template
      atomically and the anchor lives inside the row template, so the window is likely sub-frame.
      Cheapest hardening if it turns out real: one `requestAnimationFrame` re-check before throwing.
- [ ] [FIX] `openConversation`'s **fast path** (`signature !== beforeSignature` → resolve) has no
      settle counter and no node check, so it can resolve on a mid-render list and `extract()` then
      reads a half-swapped or partly-streamed conversation. QA reproduced both at production
      defaults: an old exchange still mounted with one new container appended alongside it resolved
      at 153 ms with the outgoing content (full swap was scheduled for 3000 ms), and a target
      rendering three turns 400 ms apart resolved at 459 ms on turn 1, which would export a
      truncated conversation. Three mitigations exist and are all timing-dependent:
      `collectPagedExchanges` re-reads the DOM hundreds of ms later so a fast swap self-heals,
      `assertNotStreaming` fails loud on `aria-busy`, and the walk's append-only guard fails loud
      when the final read is short of its high-water mark — but none can tell a truncated
      conversation from a short one. Natural fix per QA: require the *changed* signature to repeat
      once before accepting, mirroring the settle counter the unchanged-signature branch already
      has. Both scenarios rest on unmeasured Gemini rendering behaviour (does it ever mount both
      views at once? does it stream turns into a freshly opened conversation?), so a live session
      would settle the frequency. Predates the sprint's fix — the fast path is unchanged.
- [ ] *(deferred: inherent to the node-identity mechanism, and closing it would need the exchange
      id-value stability that is unmeasured — see docs/live-dom-verification.md → 2026-08-20)*
      [FIX] `openConversation` accepts an outgoing view that was destroyed and recreated as fresh
      nodes with a byte-identical id and text (QA's PROBE4: resolves at 455 ms with the outgoing
      content). Node identity proves a render *occurred*, not *which* conversation rendered.
      Recorded so the limit is on the record rather than rediscovered.
- [ ] [REFACTOR] Extract the scroll-walk helpers duplicated across all three adapters —
      `findScrollableAncestor`, `delay`, the accumulate-`Map` dedupe and the clamped-port settle
      loop — into `src/core/sidebar.ts`, which today holds only the `SidebarConversation`
      interface. Gemini's arrival made it three copies rather than two. Provider-specific selectors
      and page-size oracles stay in their adapters (Golden Principle #3); only the mechanics move.


## Next (roadmap — not v1)

- [ ] *(blocked by: Gemini Notebooks list markup is unmeasured — the measuring account has zero notebooks, so the sidebar section renders only its create button)*
      Gemini adapter: Notebooks track (`matchesProject` + the project bulk members). Narrowed
      2026-08-10: the **Gems half was dropped as not-applicable** — `/gem/<id>` is a Gem-scoped new
      chat screen (0 `div.conversation-container`, 0 `a[href^="/app/"]`, an `empty-disclaimer`), not
      a home listing that Gem's conversations, so there is no member list to enumerate. Notebooks
      (`[data-test-id="notebooks-expandable-section"]`, `/notebooks/create`, `project-sidenav-list`)
      is Gemini's actual project analogue and is what this item now covers.
