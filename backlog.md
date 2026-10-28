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

### v1.15.0 pre-release checks (2026-10-27)

- [ ] [FIX] A cold-loaded Gemini conversation exports as `Gemini conversation`: `document.title` stayed `Google Gemini` for ≥ ~40 s, so `deriveTitle` fell back; sidebar-reached ones carried the real title (source: live-DOM) — `docs/live-dom-verification.md` → Gemini 2026-10-27 *(blocked by: a live Gemini session measuring cold-load titles across several conversations — only one conversation, two cold loads so far; pace loads, `google.com/sorry` rate-limits cold `page.goto` loops)*

### Share-copy emphasis balance follow-ups (2026-10-28)

- [ ] [FIX] A re-emitted closer touching a letter does not render: `<em>김</em> 철수님이` with term `김 철수` → `*[REDACTED]*님이`, and CommonMark does not treat `]*님` as right-flanking, so the `*` shows literally; cosmetic, no leak, and v1.15.0 was also broken (`*[REDACTED]님`) (source: qa-verifier) — `src/core/share-copy.ts` `replaceSpans`

### PR #118 — exclude the Claude screenshot from the English store upload set (2026-10-11)

- [ ] [doc] Remove `screenshot-03-claude-conversation.png` from the default (English) locale's screenshots in the Developer Dashboard if the live listing still carries it, then confirm the published English listing — not only the Dashboard preview — shows shots 1, 2, 4 and 5 (source: code-review) — `docs/store-listing.md` → *English upload set* *(blocked by: human-only Developer Dashboard action — the public English listing still showed shot 3 ("Same buttons on Claude") as one of five screenshots on 2026-10-24)*

### QA pass on the `/recents` bulk track + empty-project fix (2026-08-11)

> Non-blocking findings from the independent QA of the sprint that shipped the Claude `/recents`
> bulk track. None held the PR; each is either a pre-existing gap the sprint made visible or a
> limit that needs a measurement session to close.

- [ ] *(blocked by: needs an account holding zero conversations — the measuring account holds 26)*
      [FIX] `/recents` on a brand-new account takes the loud branch, so a user with no
      conversations could be shown a markup-drift error instead of an empty state. Unlike the
      project track there is no measured shell marker for `/recents` to separate the two.

### PR #61 (Claude navigation/stream failure modes, 2026-08-10)

*(No open items — the sidebar-recycling `[FIX]` was closed 2026-08-10 by measurement rather than by
a change: the sidebar does not page at all, so the mid-walk reveal it guarded against cannot occur.
The larger hazard that measurement exposed is filed above.)*

## ChatGPT app-shell follow-ups (2026-09-29)

> Left open by the sidebar/project/load-older batch; evidence in `docs/live-dom-verification.md`
> → 2026-09-29 "app-shell sidebar, project pages …".

- [ ] *(deferred: no positive "no older turns" marker exists — the 2026-09-29 live session searched and found none; revisit only with new DOM evidence)* [debt] A conversation that never renders the "loading earlier messages" status still waits the full 6 s load-older dwell (the drift-safe variant was chosen on 2026-09-29); only a positive "no older turns" marker would let short conversations skip it — none was found.

