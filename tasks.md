## Review Backlog

### Bulk panel "Load more" — residual: a fetch slower than the dwell still truncates silently

- [ ] [FIX] The loaders end on a fixed dwell (`SIDEBAR_STABLE_ROUNDS × SIDEBAR_STEP_DELAY_MS` = 5 s), so a `#history` page that takes longer than that — slow/tethered link, throttled or cold backend, rate-limit backoff on the last page — still returns a silent partial with no `ExtractionError`. Raised by Codex (P1) and the Claude reviewer (P3, conf 70) on PR #32; the verifier **refuted it as a blocker for that PR** (`main` had the same exit with a 450 ms dwell and no end-of-list gate, so the branch improves the hazard ~11×) but it remains a real residual. Two candidate resolutions were assessed and both rejected as-is: an *adaptive* dwell (`max(floor, 2× longest observed gap)`) cannot bootstrap — the uniformly-slow case stalls out at the **first** page boundary with zero gap samples, so the floor still does all the work; and "fail loud on the ambiguous timeout" fires on every successful run, because a genuinely complete load exits through the same stall-counter expiry. A real fix needs a completeness oracle. The only non-fabricated candidate identified is **page-size parity** ("last increment == page size ⇒ another page exists"), which is asymmetric evidence derived from counts the loader already has — but it is unusable today because the loader counts `/c/` ids only and live data shows 1042 rendered rows vs 852 `/c/` conversations, so the per-page `/c/` increment is not the page size. *(blocked by: needs a live-DOM measurement of the raw `#history` page size and whether it is stable — see `docs/live-dom-verification.md`)*

### Bulk panel "Load more" follow-up

- [ ] [VERIFY] Rendered bulk-panel UI: confirm the loaded extension's bulk panel settles into its disabled done state with prior selections preserved after a "Load more" run. *(deferred: MCP cannot load an unpacked extension — needs a manual load-unpacked session per `docs/runbook.md`)*

### Manifest least-privilege — is `host_permissions` needed at all?

- [ ] [CONSTRAINT] *(deferred: needs a manual load-unpacked session — the same gate as the other `[VERIFY]` items below)*
      Raised by the security reviewer on PR #34 (P3, conf 70) and recorded as
      **out of scope for that PR** because it is pre-existing: `manifest.config.ts` feeds one
      `HOSTS` list into both `content_scripts.matches` and `host_permissions`, but under MV3 a
      *statically declared* content script injects on `matches` alone. `host_permissions` is
      needed for cross-origin fetch/cookie access from an extension context — and this
      extension has no background service worker, makes no network calls, and downloads via
      `URL.createObjectURL` + `<a download>`. If that analysis holds, the grant is wider than
      necessary on **all three** hosts, not just the newly added `claude.ai`. Do not "fix" this
      by writing a rationale into the HOSTS comment — nobody currently knows why the entry is
      there, and inventing a justification is worse than the redundancy. Resolve it by
      experiment: drop `host_permissions`, build, load-unpacked, and confirm the toolbar still
      mounts and exports on chatgpt.com, chat.openai.com, and claude.ai. If it does, remove the
      grant; if it does not, record the actual reason it is required. Either outcome is a
      one-line comment plus a Web Store permission-justification update
      (`docs/store-listing.md`, `docs/PRIVACY.md`).

### Claude adapter — follow-ups from the 2026-07-25 live session

- [ ] [VERIFY] Rendered Claude UI: load-unpacked per `docs/runbook.md`, open a real `claude.ai/chat/<id>`, and confirm (a) the export buttons mount inside `[data-testid="wiggle-controls-actions"]` to the left of Share and wear Claude's chrome in both light and dark, (b) each of MD/PDF/JSON/HTML downloads, and (c) a long (30+ turn) conversation exports every turn — the walk is unit-covered against a recycling fake but has never run against the real virtualizer. *(deferred: MCP cannot load an unpacked extension — needs a manual load-unpacked session)*
- [ ] [VERIFY] *(blocked by: needs a live session on a conversation containing a text+attachment turn — see `docs/live-dom-verification.md`)*
      User turns holding BOTH text and a file attachment. The 2026-07-25 walk captured only
      an attachment-ONLY turn (no `user-message` node, claimed at row level by `attachmentMarkers`);
      a mixed turn was never seen, so where its tiles sit relative to `user-message` is unknown.
      Today such a turn exports its text and reports nothing about the file — an omission, not a loud
      failure, and the one place the Claude adapter is NOT at parity with the ChatGPT adapter, whose
      `readTurn` joins `[base, files]`. Not fixed blind on purpose: running `attachmentMarkers` over a
      claimed row would also sweep up a *pasted image* inside `user-message` and label it `[File: …]`.
      Capture the markup of a mixed turn, then decide whether the row-level scan should also run on
      claimed rows and how to exclude images belonging to the turn body.
- [ ] [VERIFY] *(blocked by: needs a live session on a conversation containing an artifact and a tool call — see `docs/live-dom-verification.md`)*
      Indexed rows carrying extended thinking, an artifact, or a tool call. Narrowed
      from the original item by the 2026-07-25 second live walk, which settled the *structural*
      half: a 56-row conversation measured 54 rows with one turn node, one with four, and one
      with none, so neither 1:1 nor every-row-is-matchable holds (recorded in
      `docs/live-dom-verification.md`). The 0-turn row was an attachment turn and is now
      handled; the 4-node row is an assistant turn whose blocks the existing join path exports
      intact. What remains unsettled is whether that conversation contained any of the three
      features at all — nothing in the row distinguished them — so it is still unknown how an
      artifact card or a tool call renders, and whether either yields a row the adapter cannot
      claim. Re-run the row census on a conversation *known* to contain each, and only then
      decide whether they need their own selectors.

### Gemini adapter — follow-ups from the 2026-07-25 live session

- [ ] [VERIFY] Rendered Gemini UI: load-unpacked per `docs/runbook.md`, open a real `gemini.google.com/app/<id>`, and confirm (a) the export buttons mount inside the header's `div.right-section` to the left of the 듣기 (TTS) control and wear Gemini's Material chrome in both light and dark, (b) each of MD/PDF/JSON/HTML downloads, and (c) a long (30+ exchange) conversation exports every exchange — the paging walk is unit-covered against a fake and was re-probed live by script, but the shipped extension's own walk has never run on the real page. *(deferred: MCP cannot load an unpacked extension — needs a manual load-unpacked session)*
- [ ] [VERIFY] *(blocked by: needs a live session on a conversation whose response is a generated image or a canvas/immersive panel — see `docs/live-dom-verification.md`)*
      Responses that render no `.markdown` container at all. Every measured response
      was prose and code, so shapes that plausibly render outside the prose container were never
      captured. One such response currently makes the WHOLE conversation unexportable — loudly,
      and with a "please report this" message rather than the retry advice that could never clear
      it, but it still blocks the export. Structurally the same dead end that made an
      attachment-only Claude turn unexportable before PR #35. Once the markup is captured, give
      the assistant half of `readExchange` an escape marker mirroring the user half's `[Image]`
      instead of a hard throw. Raised in review on PR #37.
- [ ] [VERIFY] *(blocked by: needs a live session on a conversation whose prompt carries a file or image — see `docs/live-dom-verification.md`)*
      User prompts holding a file or an image. `user-query img` was 0 across every
      measured conversation, so how Gemini renders an attachment tile — and whether it sits
      inside `user-query` at all — is unknown. Today a prompt with text plus a file would export
      its text and report nothing about the file (an omission, not a loud failure), and an
      image-only prompt reports `[Image]` off the standard `<img>` tag. Capture the markup, then
      decide whether a `[File: …]` marker like the ChatGPT and Claude adapters emit is possible
      without guessing at a tile selector (AGENTS.md #5).
