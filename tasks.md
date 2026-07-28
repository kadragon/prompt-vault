## Review Backlog

### Bulk panel "Load more" — residual: a fetch slower than the dwell still truncates silently

- [ ] [FIX] The loaders end on a fixed dwell (`SIDEBAR_STABLE_ROUNDS × SIDEBAR_STEP_DELAY_MS` = 5 s), so a `#history` page that takes longer than that — slow/tethered link, throttled or cold backend, rate-limit backoff on the last page — still returns a silent partial with no `ExtractionError`. **Measured 2026-07-25, no longer hypothetical:** the built extension's first "Load more" run stopped at **725 of 852** conversations (14.9% missing), cleared its status line and re-enabled the button exactly as a complete run does — see `docs/live-dom-verification.md`. Which exit fired (dwell expiry vs `endOfListGate`) was NOT isolated, so that session raises the priority without narrowing the fix. It also measured one thing that bears on the fix: reaching the panel's `All conversations loaded` state requires an extra run that grows nothing, which is strictly stronger than one run but still latches falsely if that confirming run stalls at its first page boundary. Raised by Codex (P1) and the Claude reviewer (P3, conf 70) on PR #32; the verifier **refuted it as a blocker for that PR** (`main` had the same exit with a 450 ms dwell and no end-of-list gate, so the branch improves the hazard ~11×) but it remains a real residual. Two candidate resolutions were assessed and both rejected as-is: an *adaptive* dwell (`max(floor, 2× longest observed gap)`) cannot bootstrap — the uniformly-slow case stalls out at the **first** page boundary with zero gap samples, so the floor still does all the work; and "fail loud on the ambiguous timeout" fires on every successful run, because a genuinely complete load exits through the same stall-counter expiry. A real fix needs a completeness oracle. The only non-fabricated candidate identified is **page-size parity** ("last increment == page size ⇒ another page exists"), which is asymmetric evidence derived from counts the loader already has. **Unblocked 2026-07-28** by the live-DOM session that measured what it needed (recorded in `docs/live-dom-verification.md`): the raw page is **exactly 28 rows** — zero variance across all **72 full pages** measured in two independent cold runs (74 batches; the two terminal pages were short, at 11) — confirmed independently by `scrollHeight` growing 1008 px per full page. The blocker's premise also held: the top-level `/c/` increment the loader counts ranged **11–27** and was never 28, so the oracle must count **raw rows** (`#history a[href]`, not `li`). **Do not implement the naive "pull until a page arrives short or empty" rule** — review on PR #47 found a hole at each end, both recorded in the doc. (a) An empty page is indistinguishable from an in-flight one or a >5 s stall when all you have is a row count, so parity is definitive only when the total is *not* a multiple of 28 and otherwise degrades to today's dwell heuristic. (b) Anchors lag their rows mid-fetch, so a full page can transiently read as short and fire "short ⇒ exhausted" early, recreating the very truncation this guards against; the increment must settle before it is classified. Same session re-measured the latency this guard exists for — gaps up to **7516 ms**, above the shipped 5 s dwell in both runs.

### Claude adapter — follow-ups from the 2026-07-25 live session

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
