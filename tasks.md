## Review Backlog

### Privacy gate — two subresource vectors the widened HTML scan still misses

- [ ] [CONSTRAINT] Found by QA and review attacking the widened gate on PR #42, each confirmed
      against happy-dom as something a real parser resolves to a genuine fetch. The others found in
      that round (entity-escaped and tab-smuggled schemes, the legacy `background` attribute, a
      bare-string `@import` with no whitespace) were closed in the PR itself; these two were not.
      (a) **SVG `<image>`.** `<svg><image xlink:href="https://evil.example/x.png"/></svg>` fetches
      automatically, but `href`/`xlink:href` are only checked on `<link>`/`<base>`. Widening
      `HREF_TAGS` to `image`/`use` is the obvious fix; check first whether any other SVG element
      carries a fetching `href`, and whether the plain `href` form needs its own case. Runtime is
      already covered — CSP `img-src 'self'` blocks it — so this is the static backup catching up.
      (b) **`<meta http-equiv="refresh" content="0;url=…">`.** An automatic top-level navigation
      carrying whatever is interpolated into the URL. Neither layer stops it: the gate does not
      read `content=`, and Chrome dropped CSP `navigate-to`, so there is no directive to add. This
      is the ONLY vector with no runtime control behind it, which makes the static fix the whole
      control rather than a backup — weigh it accordingly.

### Bulk panel "Load more" — residual: a fetch slower than the dwell still truncates silently

- [ ] [FIX] The loaders end on a fixed dwell (`SIDEBAR_STABLE_ROUNDS × SIDEBAR_STEP_DELAY_MS` = 5 s), so a `#history` page that takes longer than that — slow/tethered link, throttled or cold backend, rate-limit backoff on the last page — still returns a silent partial with no `ExtractionError`. **Measured 2026-07-25, no longer hypothetical:** the built extension's first "Load more" run stopped at **725 of 852** conversations (14.9% missing), cleared its status line and re-enabled the button exactly as a complete run does — see `docs/live-dom-verification.md`. Which exit fired (dwell expiry vs `endOfListGate`) was NOT isolated, so that session raises the priority without narrowing the fix. It also measured one thing that bears on the fix: reaching the panel's `All conversations loaded` state requires an extra run that grows nothing, which is strictly stronger than one run but still latches falsely if that confirming run stalls at its first page boundary. Raised by Codex (P1) and the Claude reviewer (P3, conf 70) on PR #32; the verifier **refuted it as a blocker for that PR** (`main` had the same exit with a 450 ms dwell and no end-of-list gate, so the branch improves the hazard ~11×) but it remains a real residual. Two candidate resolutions were assessed and both rejected as-is: an *adaptive* dwell (`max(floor, 2× longest observed gap)`) cannot bootstrap — the uniformly-slow case stalls out at the **first** page boundary with zero gap samples, so the floor still does all the work; and "fail loud on the ambiguous timeout" fires on every successful run, because a genuinely complete load exits through the same stall-counter expiry. A real fix needs a completeness oracle. The only non-fabricated candidate identified is **page-size parity** ("last increment == page size ⇒ another page exists"), which is asymmetric evidence derived from counts the loader already has — but it is unusable today because the loader counts `/c/` ids only and live data shows 1042 rendered rows vs 852 `/c/` conversations, so the per-page `/c/` increment is not the page size. *(blocked by: needs a live-DOM measurement of the raw `#history` page size and whether it is stable — see `docs/live-dom-verification.md`)*

### Manifest — `chat.openai.com` is an inert `HOSTS` entry

- [ ] [CONSTRAINT] Surfaced by the 2026-07-25 `host_permissions` experiment, which could not
      measure this host: `GET https://chat.openai.com/c/<id>` returns **HTTP 308** to
      `https://chatgpt.com/c/<id>`, so no document ever loads on that origin and the content
      script never runs there (recorded in `docs/live-dom-verification.md`). The entry is
      therefore inert — it costs a line in the install-time host warning and a row in the Web
      Store permission justification while granting access to nothing reachable. Removing it is
      *probably* right but was deliberately left out of that PR: a 308 measured once is not proof
      the origin is permanently redirect-only, and if OpenAI ever serves conversation pages there
      again, a dropped entry fails silently (no toolbar, no error) rather than loudly — the exact
      shape Golden Principle #4 exists to prevent. Decide deliberately: either drop it from
      `HOSTS` and note in `manifest.config.ts` that the origin is redirect-only as of the
      measurement date, or keep it and record *why* an unreachable host is worth the grant. Do
      not resolve by assuming the redirect is permanent. Either outcome updates
      `docs/store-listing.md` and `docs/PRIVACY.md`, whose host lists both name it.

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
