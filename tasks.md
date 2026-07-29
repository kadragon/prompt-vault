## Review Backlog

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
