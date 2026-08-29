# Delegation

Solo, greenfield repo — **default to inline work**. Delegate only when an objective trigger fires.
Overhead of a subagent spawn is only worth it when it keeps this context lean or enforces
generator/evaluator separation.

## Objective triggers (routing table)

| Trigger (objective, measurable) | Delegate to | Mode | Gate |
|---------------------------------|-------------|------|------|
| First time mapping a provider's live conversation DOM this session | `explorer` | sub-agent | Recommended |
| Target area spans >5 files, or output would flood context (>20 lines) | `explorer` | sub-agent | Recommended |
| Implementation run in parallel/batch (`task-next --all`, worktree isolation), or spanning >5 files | `implementer` | sub-agent | Recommended |
| After any implementation | `qa-verifier` | sub-agent | **Mandatory** — whoever implemented must not verify their own work |
| Before a Web Store release, or a feature shipping new user-visible UI (against `docs/eval-criteria.md`) | `product-evaluator` | sub-agent | Mandatory |

**The lead implements by default.** A Sprint Contract is not itself a delegation trigger — an
ordinary single-session change is written inline, and `qa-verifier` still runs against it. Spawn
`implementer` only when the work is genuinely parallel or would flood this context.

Nothing here is path-blocking (no critical-path hook) — this is a client-side extension with no
server, auth, or migrations. The one hard rule is generator ≠ evaluator: whoever wrote the code does
not grade it.

**This table is the owner; two other places restate it, and a test holds them together.** A
routing rule has to read the same in the matching step of `docs/workflows.md` (Steps 1, 3–5) and in
the spawning agent's own `description:` in `.claude/agents/{agent}.md` — an agent routes off
whichever it reads first, so a partial edit produced silently contradictory routing. `AGENTS.md`
used to carry a fourth copy; it now points here instead.

`test/harness/routing-consistency.test.ts` pins the discriminating phrase of each trigger — the
phrases live only in that test's `ROLES` list, deliberately not restated in this prose — and fails
unless each one appears in all three places *and* in the table above. Changing a trigger therefore means changing the table, the
workflow step, the agent description, and the phrase list in that test — and touching only one of
them is RED, not silent drift.

## Spawn Prompt Contract (four fields)

Every spawn brief includes:

1. **Objective** — one sentence, the exit criterion.
2. **Output format** — what to return (structured findings, a patch, a pass/fail verdict + evidence).
3. **Tools / files** — absolute paths of in-scope files, the lint/build command, relevant docs.
4. **Boundaries** — what NOT to touch; for `qa-verifier`, "read-only, do not fix."

## Model routing (guidance)

- `explorer`, `implementer`, `qa-verifier` — default session model is fine for this repo's size.
- `product-evaluator` — a higher-capability model helps for judgment; otherwise inherit.

Escalate a model only on a concrete failure (same fix fails 2×), not preemptively.

## Data transfer

Intermediate artifacts go in the session scratchpad dir named `{phase:02d}_{agent}_{artifact}.{ext}`.
Return conclusions to the main context, not raw dumps.
