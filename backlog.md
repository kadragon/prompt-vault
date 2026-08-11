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
- [ ] [FIX] Re-capture `screenshot-05-exported-pdf.png` (both locales) from a conversation that
      contains `=>` and an inline-code run, once the two PDF rendering items below are fixed. The
      shipped capture uses Python/shell only, which keeps the caption honest but means the shot no
      longer exercises the two cases most likely to regress.

### PDF rendering artifacts seen while capturing store screenshots (2026-08-11)

> Both were observed in a real export (`chatgpt-…-Python-and-bash-snippets-20260811.pdf`) made
> while capturing `assets/store/screenshot-05-exported-pdf.png`. Cosmetic, but they land in the
> one artifact the listing shows off, so they are worth closing before wide distribution.

- [ ] [FIX] Inline code loses its markers in the PDF but keeps its backticks. A prose run that
      ChatGPT renders as `<code>reduce()</code>` reaches the PDF as the literal text
      `` `reduce()` `` — the Markdown fence is emitted, but the PDF has no inline-code style to
      justify it. Decide one way: style the run (monospace/tint) and drop the backticks, or leave
      the text plain. Pin whichever with a test on the PDF text runs.
- [ ] [FIX] The PDF's monospace font substitutes coding ligatures into code text. `=>` renders as
      `⇒` in an exported JavaScript block, so what the reader copies out of the PDF does not match
      what the page showed. Disable the ligature feature for the code font (or pick a
      non-ligature face) and assert `=>` survives a round trip.

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

### QA follow-ups on the track attribute + history rewind (2026-08-11)

> Non-blocking observations from the independent QA of the sprint that closed five items in the
> group above. Both are missing coverage for a branch that sprint added, not defects in it.

- [ ] [TEST] The already-on-route path's "fires zero `back()` calls" guarantee is pinned only by
      tests with a 200 ms timeout — below the 3000 ms `RETURN_BACK_RETRY_MS` threshold — so they
      would stay green even if `rewind` were wrongly set on that path. The guarantee currently
      rests on `rewind` staying `null`. Add a case that runs past the retry threshold.
- [ ] [TEST] An unstamped legacy container (no `data-prompt-vault-track`) is treated as stale by
      design, documented at `src/content/mount.ts:635-638`, but no test asserts it. One case
      would pin the doc comment.

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
