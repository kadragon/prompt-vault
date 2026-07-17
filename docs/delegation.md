# Delegation

Solo, greenfield repo — **default to inline work**. Delegate only when an objective trigger fires.
Overhead of a subagent spawn is only worth it when it keeps this context lean or enforces
generator/evaluator separation.

## Objective triggers (routing table)

| Trigger (objective, measurable) | Delegate to | Mode | Gate |
|---------------------------------|-------------|------|------|
| First time mapping a provider's live conversation DOM this session | `explorer` | sub-agent | Recommended |
| Target area spans >5 files, or output would flood context (>20 lines) | `explorer` | sub-agent | Recommended |
| After any implementation | `qa-verifier` | sub-agent | **Mandatory** — implementer must not self-verify |
| Feature complete (against `docs/eval-criteria.md`) | `product-evaluator` | sub-agent | Mandatory |

Nothing here is path-blocking (no critical-path hook) — this is a client-side extension with no
server, auth, or migrations. The one hard rule is generator ≠ evaluator: whoever wrote the code does
not grade it.

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
