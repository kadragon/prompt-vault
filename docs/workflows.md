# Workflows

Pick the primary workflow per cycle. Adapted for a solo, greenfield browser-extension repo.

## `plan` — Spec Generation

Expand a short request into a design doc before building anything non-trivial.

1. Write `docs/design/{slug}.md`: user stories, high-level tech design (adapter/export shape,
   PDF approach, build tooling), phased feature list. No granular code.
2. Review with the user. Do not proceed until approved.
3. Generate `backlog.md` items from the approved spec, in dependency order.

Skip for trivial features.

## `code` — Implementation

The primary cycle for behavioral changes.

**Step 0: Branch** — never edit on `main`. `git checkout -b <type>/<slug>` (`feat/`, `fix/`, `refactor/`).

**Step 1: Scope check** — objective delegation triggers (see `docs/delegation.md`): first time
reading an adapter's live DOM structure, or target area >5 files → spawn `explorer` first. Else proceed.

**Step 2: Sprint Contract** — before writing code, define "done" in concrete, testable terms in
`tasks.md`. Template + criteria in `docs/eval-criteria.md`. Approach for this repo:
reference the target site DOM / existing adapter → implement → lint/build → load-unpacked manual check.

**Step 3: Implement** — ≤2 files and not `[FEAT]`/`[REFACTOR]` → inline. Larger → spawn `implementer`
with the Sprint Contract, in-scope file paths, and the lint/build command.

**Step 4: QA (mandatory)** — always spawn `qa-verifier`. The agent that implemented must NOT verify
its own work. Verify against the Sprint Contract, including a real load-unpacked run where relevant.

**Step 5: Feature-complete evaluation** — when a feature is done, spawn `product-evaluator` against
`docs/eval-criteria.md`.

**Step 6: Version bump & handoff** — bump `manifest.json` version + `package.json` if present. Leave
uncommitted for the review cycle.

**`backlog.md` item format:**

```markdown
## Feature Name
> Goal: what and why.
> Done-when: concrete acceptance criteria (agreed BEFORE coding).

- [ ] Simplest case
- [ ] Next case builds on previous
```

The active-sprint `tasks.md` schema: a `# Title`, `status: active`, and **Scope /
Acceptance criteria / Out of scope / Lint/test command** sections (one Sprint Contract at a time).

## `draft` — Documentation

Update `docs/`. Ground every claim in current code. Never touch production code. If a doc reveals a
missing constraint, add a `backlog.md` item.

## `constrain` — Structural Enforcement

Write the lint rule / structural test first, run it, and if current code violates it, add remediation
to `backlog.md` rather than fixing inline. Update `docs/architecture.md`.

## `explore` — Research

State the question → inspect the live site DOM / prototype → report options and tradeoffs → do not
commit. Flows into `plan` or `code` if approved.

## Permitted side-effects

- During `code`: add a `[doc]`/`[constraint]` note to `tasks.md`; update docs after implementing.
- During `draft`: add a `backlog.md` item when a doc reveals missing behavior.
- Not permitted: writing production code during `draft`.

## Context anxiety

On long multi-feature builds, quality can degrade late (stub-implementing later items, premature
"done"). Countermeasure for this repo: decompose into one-adapter-or-one-format sprints with a
`qa-verifier` gate between them, rather than one giant session.
