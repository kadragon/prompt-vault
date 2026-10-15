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

### PR #118 — exclude the Claude screenshot from the English store upload set (2026-10-11)

- [ ] [doc] Remove `screenshot-03-claude-conversation.png` from the default (English) locale's screenshots in the Developer Dashboard if the live listing still carries it, then confirm the published English listing — not only the Dashboard preview — shows shots 1, 2, 4 and 5 (source: code-review) — `docs/store-listing.md` → *English upload set* *(blocked by: human-only Developer Dashboard action — whether the live listing currently holds shot 3 is unverified)*

### PR #119 — read Claude's redesigned artifact cards (2026-10-15)

- [ ] [constraint] `artifactInner` treats any `[data-testid="file-card-open"]` without a `group/artifact-block` root as a renamed artifact root and aborts the whole export; a future non-artifact file card carrying that test id would make a readable conversation unexportable. Measured 0 outside artifact cards (one 3-artifact and one 6-attachment conversation); re-check on a code-execution output file and require the title/kind pair before rejecting if one appears (source: code-review + qa-verifier, low confidence) — `src/adapters/claude/selectors.ts:233` (introduced here)

### QA pass on the `/recents` bulk track + empty-project fix (2026-08-11)

> Non-blocking findings from the independent QA of the sprint that shipped the Claude `/recents`
> bulk track. None held the PR; each is either a pre-existing gap the sprint made visible or a
> limit that needs a measurement session to close.

- [ ] [debt] Narrow `ARTIFACT_KIND_SEPARATORS` to U+00B7. Measured 2026-10-15 on ko-KR, ja-JP,
      zh-Hans and zh-Hant: every two-part kind uses U+00B7 and none uses U+30FB or U+2022
      (`docs/live-dom-verification.md` → Claude, 2026-10-15).
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

## Next (roadmap — not v1)

- [ ] Gemini adapter: Notebooks track (`matchesProject` + the project bulk members). Narrowed
      2026-08-10: the **Gems half was dropped as not-applicable** — `/gem/<id>` is a Gem-scoped new
      chat screen, not a home listing. Notebooks are Gemini's project analogue; their markup was
      measured 2026-10-15 (`docs/live-dom-verification.md` → Gemini, 2026-10-15): home at
      `/notebook/<uuid>`, members are `project-chat-row` buttons with **no conversation id in the
      markup**, so member enumeration must click each row and read the resulting `/app/<id>`.
      Notebook chats are also missing from the global sidebar, which is why this matters — see the
      `[FIX]` item below.
- [ ] [FIX] Gemini bulk export silently omits every conversation that lives in a notebook: the
      global sidebar it walks never lists them (0 of 2 newest notebook chats among 32 rows,
      2026-10-15). At minimum the bulk panel should say notebook chats are not included; the full
      fix is the Notebooks track above.
