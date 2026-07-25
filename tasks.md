## Review Backlog

### Bulk panel "Load more" — residual: a fetch slower than the dwell still truncates silently

- [ ] [FIX] The loaders end on a fixed dwell (`SIDEBAR_STABLE_ROUNDS × SIDEBAR_STEP_DELAY_MS` = 5 s), so a `#history` page that takes longer than that — slow/tethered link, throttled or cold backend, rate-limit backoff on the last page — still returns a silent partial with no `ExtractionError`. Raised by Codex (P1) and the Claude reviewer (P3, conf 70) on PR #32; the verifier **refuted it as a blocker for that PR** (`main` had the same exit with a 450 ms dwell and no end-of-list gate, so the branch improves the hazard ~11×) but it remains a real residual. Two candidate resolutions were assessed and both rejected as-is: an *adaptive* dwell (`max(floor, 2× longest observed gap)`) cannot bootstrap — the uniformly-slow case stalls out at the **first** page boundary with zero gap samples, so the floor still does all the work; and "fail loud on the ambiguous timeout" fires on every successful run, because a genuinely complete load exits through the same stall-counter expiry. A real fix needs a completeness oracle. The only non-fabricated candidate identified is **page-size parity** ("last increment == page size ⇒ another page exists"), which is asymmetric evidence derived from counts the loader already has — but it is unusable today because the loader counts `/c/` ids only and live data shows 1042 rendered rows vs 852 `/c/` conversations, so the per-page `/c/` increment is not the page size. *(blocked by: needs a live-DOM measurement of the raw `#history` page size and whether it is stable — see `docs/live-dom-verification.md`)*

### Bulk panel "Load more" follow-up

- [ ] [VERIFY] Rendered bulk-panel UI: confirm the loaded extension's bulk panel settles into its disabled done state with prior selections preserved after a "Load more" run. *(deferred: MCP cannot load an unpacked extension — needs a manual load-unpacked session per `docs/runbook.md`)*

### Manifest least-privilege — is `host_permissions` needed at all?

- [ ] [CONSTRAINT] Raised by the security reviewer on PR #34 (P3, conf 70) and recorded as
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
      (`docs/store-listing.md`, `docs/PRIVACY.md`). *(deferred: needs a manual load-unpacked
      session — the same gate as the other `[VERIFY]` items below)*

### Claude adapter — follow-ups from the 2026-07-25 live session

- [ ] [VERIFY] Rendered Claude UI: load-unpacked per `docs/runbook.md`, open a real `claude.ai/chat/<id>`, and confirm (a) the export buttons mount inside `[data-testid="wiggle-controls-actions"]` to the left of Share and wear Claude's chrome in both light and dark, (b) each of MD/PDF/JSON/HTML downloads, and (c) a long (30+ turn) conversation exports every turn — the walk is unit-covered against a recycling fake but has never run against the real virtualizer. *(deferred: MCP cannot load an unpacked extension — needs a manual load-unpacked session)*
- [ ] [VERIFY] Attachment-only user turns. Raised on PR #34 (P1, conf 60) as the most likely
      real-world extraction failure in the new adapter, and NOT closeable from code: the
      2026-07-25 session captured only text turns. A user turn holding only an uploaded FILE
      yields no text, so `buildMessages` throws "Some conversation turns could not be
      read… wait for it to finish, then try again" — an error that never resolves, permanently
      blocking export of any conversation containing one. (Image-only turns are already
      handled: `readUserContent` emits `[Image]` off the standard `<img>` tag.) Capture the
      markup of a file-attachment tile inside `[data-testid="user-message"]`, then add a
      marker path mirroring the ChatGPT adapter's `fileMarkers` (`[File: name]`). Until then
      the failure is at least loud, not silent.
- [ ] [VERIFY] Indexed rows that are not plain text turns — extended-thinking blocks, artifact
      cards, tool calls. Raised on PR #34 (P1 conf 55 / P2 conf 50). Two adapter assumptions
      rest on one 50-turn conversation that contained none of these: (a) exactly one turn node
      per `[data-index]` row, and (b) every indexed row is a turn the adapter can match.
      Both now degrade safely rather than silently — several nodes in a row are joined, and a
      gap whose row DID render reports "could not read" instead of blaming the walk — but a
      conversation with an artifact still fails loud rather than exporting it. Measure
      `turnsPerRow` and the matched-vs-indexed row counts on a conversation containing an
      extended-thinking response, an artifact, and a tool call, then decide whether those rows
      need their own selectors.
- [ ] [VERIFY] Confirm whether Claude's `data-index` is 0-based. The 2026-07-25 snippet dropped `min`/`max` from its output, so `buildMessages` asserts only that the collected indices are **contiguous**, not that they start at 0. If the index is 0-based, a `min !== 0` check would additionally catch a walk that never reached the first turn — today only the reached-top guard covers that. One console snippet on a long conversation answers it.
