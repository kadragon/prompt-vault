# Harness Log

Loop-originated harness edits, each paired with a falsifiable prediction. `dev:harness-curate`
Step 2.5 re-reads the `pending` / `unverified` rows on a later audit, stamps the ones that held,
and surfaces the failures as rework candidates. An unrecorded edit can never be falsified, so
every change to this repo's rules, docs-as-rules, agents, or harness tests belongs here.

**Change History:**

| Date | Change | Scope | Reason | Predicted impact | Verified |
|------|--------|-------|--------|------------------|----------|
| 2026-08-29 | Collapse the delegation routing copies 4 → 3 and gate them with a test | `AGENTS.md`, `docs/delegation.md`, `docs/workflows.md`, `.claude/agents/*.md`, `test/harness/routing-consistency.test.ts` | `docs/delegation.md:25` documented its own 4-place duplication and defended it with "grep before you change it" — a verbal rule where a mechanical one fits | A trigger reworded in one place only turns `npm test` red instead of drifting silently; over the next 5 sessions no agent routes off a trigger that disagrees with `docs/delegation.md` | 2026-08-29 — non-vacuity: four single-place neutralizations (workflows.md `parallel/batch`, explorer.md `>5 files`, delegation.md `After any implementation`, a re-added AGENTS.md copy) each went RED, restored green at 30/30 |
| 2026-08-29 | Add a project-local `release` skill | `.claude/skills/release/SKILL.md`, `docs/runbook.md` | The release cycle was reassembled from 9 separate user prompts across 4+ sessions ("버전 범프하고 다시 패키징해줘", "릴리스 워크플로 돌려서 GitHub Release도 만들어줘"); the commands were documented, the order and gates were not | The next release runs from one prompt through to the store handoff; the user issues no mid-cycle "and now package it" follow-up | pending |
| 2026-08-29 | Live-DOM sessions must enumerate the measurable set up front and drive it to exhaustion | `docs/live-dom-verification.md` → `## The loop` Step 0 and Step 5 | 8 prompts across sessions were the user re-prompting for the next measurement ("추가 측정할거 없어?", "마져 측정해줘", "이제 남은 block 없나?"), each costing a fresh login | The next live-DOM session opens with the enumerated list and closes reporting every entry measured/unmeasurable; zero user prompts asking what is left | pending |
| 2026-08-29 | Name `humanize-korean` as mandatory for user-facing Korean prose | `AGENTS.md` → Language Policy, `.claude/skills/release/SKILL.md` | The skill fired 0× across 39 sessions despite 3 exact-domain requests ("국문 설명에 대해서, AI 느낌안나게"); its own description could not be fixed durably (third-party plugin under a versioned cache) | The next Korean store-listing or announcement draft routes through the skill without the user asking for it | unverified |
| 2026-08-29 | Delete instruction lines already imposed by a higher layer | `AGENTS.md` → Token Economy, Language Policy | `~/.codex/AGENTS.md` is byte-identical to `~/.claude/CLAUDE.md`, so a repo copy of a global rule buys no cross-tool reach; parallel tool calls and "code/docs in English" are already imposed every turn | AGENTS.md stays under its 100-line budget with no observed regression in parallel tool use or commit language over the next 5 sessions | pending |
