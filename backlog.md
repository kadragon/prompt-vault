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

> Opened by the 2026-07-29 live session. Each item names the function or file the fix lands in,
> with the evidence in `docs/live-dom-verification.md` → 2026-07-29 or 2026-08-09. The three
> Claude items that session fully measured — both attachment tile shapes, mixed-turn attachments,
> and expanded extended thinking — landed in v1.8.0. The artifact-card item is now actionable;
> the termination-condition item remains parked because the 2026-08-09 long-response session
> observed streaming and ordinary row recycling but not the active-recycled-row case.

- [ ]
      [FEAT] Claude: an **artifact** is omitted from the export — its card sits outside
      `.standard-markdown`. Emit a marker from the card (title + kind, e.g. `HTML`).
- [ ] *(blocked by: how `data-is-streaming` reads on a row the virtualizer has already recycled — named unmeasured in the item itself and in docs/live-dom-verification.md. Needs a live-DOM session.)*
      [FEAT] Give the Claude walk a real termination condition — one that can tell "the newest turn
      stopped growing" from "the newest turn is off-screen". PR #36 established that
      `aria-setsize` cannot do this on its own: the walk collects the bottom turn as a fragment,
      the virtualizer recycles that row away, and every "is it complete / has it gone quiet?"
      test then passes at the top of the conversation while the response is still streaming
      (measured: early exit at round 17 exporting a 4-character fragment vs 32 rounds exporting
      the full answer — see `docs/live-dom-verification.md` → "a declared total is an oracle, not
      a termination condition"). Today the walk therefore runs both passes to their scroll ends,
      which is correct but pays a full second traversal on every export. The
      **stream-completion signal** this needs was measured 2026-07-29 and is
      **`data-is-streaming`**: one node per assistant row, on a div wrapping `.standard-markdown`,
      `"true"` only while that turn generates and `"false"` on every completed turn including
      after a reload (420 samples / 84 s — see `docs/live-dom-verification.md` → Claude →
      2026-07-29). Two constraints the implementation must respect: it flips `false` in the same
      200 ms sample as the final text chunk, so it marks the end but grants no quiet-period
      margin; and the row appears ~1.2 s *before* its stream node exists, so "no node yet" must
      not read as "finished". Still unmeasured, and the case this item actually turns on: how the
      attribute reads on a row the virtualizer has already recycled — settle that before relying
      on it to end the walk. Note the same signal would also improve on today's behavior at the
      bottom, where the walk stops on scroll-settle regardless of whether the last turn is still
      growing.

## Next (roadmap — not v1)

- [ ]
      Claude adapter: bulk/sidebar export (`listConversations` / `openConversation` /
      `loadMoreConversations`)
- [ ] *(blocked by: the measured project homes exposed only a recent-chat table; project-member bulk markup and its pagination contract remain unmeasured)*
      Claude adapter: Projects track (`matchesProject` + the project bulk members)
- [ ] *(blocked by: needs its own live-DOM session — only the conversation view was measured on 2026-07-25; the sidebar was seen in passing (33 `[data-test-id="conversation"]` anchors in their own `infinite-scroller`) but its paging shape, scroll port, and whether it loads from the server were never measured)*
      Gemini adapter: bulk/sidebar export (`listConversations` / `openConversation` /
      `loadMoreConversations`)
- [ ] *(blocked by: Gemini's Gems and project routes and their list markup are unmeasured — `matches` deliberately excludes them, so those pages currently mount nothing)*
      Gemini adapter: Gems / Projects track (`matchesProject` + the project bulk members)
