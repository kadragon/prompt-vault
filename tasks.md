# Review Backlog

### Ticket 1 follow-up (scaffold) — manual verification

- [ ] [VERIFY] Load-unpacked on live chatgpt.com: confirm the Download button appears top-right only on `/c/<id>` pages, toggles correctly on SPA navigation (sidebar conversation clicks, back/forward) via the isolated-world `location` polling in `src/content/index.ts`, and that ChatGPT's page CSP does not interfere with the content script. Deferred from ticket 1 — needs a logged-in browser session, which the agent cannot drive.

### Privacy gate hardening (ticket 2 follow-up)

Findings from the commit security review of the no-external-network gate
(`test/privacy/no-external-network.test.ts`). The gate is a static grep tripwire by
design (per `docs/conventions.md`) — these widen its net cheaply without turning it into
an AST analyzer. Semantic-escape resistance is out of scope for the regex gate; see the
CodeQL/data-flow option in `backlog.md` for that.

- [ ] [CONSTRAINT] Scan `.js`/`.mjs`/`.cjs`/`.jsx` in addition to `.tsx?` so a future non-TS file in the guarded paths can't slip a network call past the gate.
- [ ] [CONSTRAINT] Reduce parser-differential false-negatives: strip line/block comments and match across joined source (not per-line) so a split `fetch\n(` call is still caught. Keep false-positive risk low (skip matches inside string literals).
