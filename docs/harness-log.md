# Harness Log

Loop-originated harness edits, each paired with a falsifiable prediction. `dev:harness-curate`
Step 2.5 re-reads the `pending` / `unverified` rows on a later audit, stamps the ones that held,
and surfaces the failures as rework candidates. An unrecorded edit can never be falsified, so
every change to this repo's rules, docs-as-rules, agents, or harness tests belongs here.

**Change History:**

| Date | Change | Scope | Reason | Predicted impact | Verified |
|------|--------|-------|--------|------------------|----------|
| 2026-10-09 | Replace three measurement-dependent backlog scopes with conservative, independently actionable work | `backlog.md` | English screenshot omission already had an allowed fallback; Gemini error wording and byte-identical stale-render rejection do not require new provider guarantees | Candidate selection exposes three items while preserving all eight remaining blocked/deferred items; no measurement is promoted beyond its observed scope | Independent read-only review confirmed the fallback and code paths; candidate and preservation checks recorded below |
| 2026-08-29 | Collapse the delegation routing copies 4 → 3 and gate them with a test | `AGENTS.md`, `docs/delegation.md`, `docs/workflows.md`, `.claude/agents/*.md`, `test/harness/routing-consistency.test.ts` | `docs/delegation.md:25` documented its own 4-place duplication and defended it with "grep before you change it" — a verbal rule where a mechanical one fits | A trigger reworded in one place only turns `npm test` red instead of drifting silently; over the next 5 sessions no agent routes off a trigger that disagrees with `docs/delegation.md` | 2026-08-29 — non-vacuity: four single-place neutralizations (workflows.md `parallel/batch`, explorer.md `>5 files`, delegation.md `After any implementation`, a re-added AGENTS.md copy) each went RED, restored green at 30/30 |
| 2026-08-29 | Add a project-local `release` skill | `.claude/skills/release/SKILL.md`, `docs/runbook.md` | The release cycle was reassembled from 9 separate user prompts across 4+ sessions ("버전 범프하고 다시 패키징해줘", "릴리스 워크플로 돌려서 GitHub Release도 만들어줘"); the commands were documented, the order and gates were not | The next release runs from one prompt through to the store handoff; the user issues no mid-cycle "and now package it" follow-up | pending |
| 2026-08-29 | Live-DOM sessions must enumerate the measurable set up front and drive it to exhaustion | `docs/live-dom-verification.md` → `## The loop` Step 0 and Step 5 | 8 prompts across sessions were the user re-prompting for the next measurement ("추가 측정할거 없어?", "마져 측정해줘", "이제 남은 block 없나?"), each costing a fresh login | The next live-DOM session opens with the enumerated list and closes reporting every entry measured/unmeasurable; zero user prompts asking what is left | pending |
| 2026-08-29 | Name `humanize-korean` as mandatory for user-facing Korean prose | `AGENTS.md` → Language Policy, `.claude/skills/release/SKILL.md` | The skill fired 0× across 39 sessions despite 3 exact-domain requests ("국문 설명에 대해서, AI 느낌안나게"); its own description could not be fixed durably (third-party plugin under a versioned cache) | The next Korean store-listing or announcement draft routes through the skill without the user asking for it | unverified |
| 2026-08-29 | Delete instruction lines already imposed by a higher layer | `AGENTS.md` → Token Economy, Language Policy | `~/.codex/AGENTS.md` is byte-identical to `~/.claude/CLAUDE.md`, so a repo copy of a global rule buys no cross-tool reach; parallel tool calls and "code/docs in English" are already imposed every turn | AGENTS.md stays under its 100-line budget with no observed regression in parallel tool use or commit language over the next 5 sessions | pending |

## 2026-10-09 — blocked queue audit

All 11 items were assessed. Three are actionable engineering/documentation alternatives,
not completed fixes or newly verified provider contracts. Eight retain their original markers.

| Remaining condition | Evidence and next prerequisite |
|---|---|
| Firefox-oriented `addons-linter` | Existing Chrome-only decision unchanged; revisit with Firefox support, not by removing the deferral. |
| Multiline queue pruning | In-memory `prune_lines` reproduction against both installed dev 4.10.15 and `agent-toolkit` source returned no problems, removed the selected checkbox, retained its orphan continuation, and preserved the neighboring blocked item. External repository fix still required. |
| Claude document-only project | Native Chrome opened `/cowork/projects`; the rendered page offered project creation without a listed project. This UI observation does not establish an empty-account or document-table DOM contract. A document-only fixture remains necessary. |
| Claude ja/zh artifact separator | Current native Claude UI is Korean. No alternate-language artifact fixture was measured and no account/locale change was performed. |
| Empty Claude history | Native `/recents` displayed existing conversations. No empty account is available from that observation; no conversations were deleted. |
| ChatGPT naturally long project | No new overflow fixture or DOM measurement performed. The latest recorded eight-conversation sample remains insufficient. |
| ChatGPT positive end-of-history marker | No new DOM measurement or positive marker found in this audit; preserve the six-second dwell. |
| Gemini Notebook member markup | Native Gemini offered only a new-Notebook link; opening it reached `/notebooks/splash?dest=create`, with onboarding and a Start button. No Notebook was created and no member-list DOM contract was measured. |

Browser access used native Chrome Computer Use. DOM tooling was not used: `aside guide`
reported installed CLI 1.26.916.1741 and available CLI 1.26.1008.1938; the skill requires
an update before continuing, and permission for that outside-repository change was requested.
Native accessibility observations cannot resolve cold/subframe hydration, provider-wide
exchange identity, or latency. No conversation text or account identifiers are recorded here.

Independent review traced the Gemini scopes to `assertSidebarExpanded`,
`waitForOpenedConversation`, `messageSignature`, and the same-length-text navigation test.
The installed and source pruning reproduction agreed with the independent verifier.

Validation: `backlog_candidates.py --tasks tasks.md --backlog backlog.md --full-scan`
returned the screenshot group (one item) and Gemini group (two items). A comparison against
`HEAD:backlog.md` asserted 11 total items, exactly three changed scopes, and eight byte-identical
remaining blocker lines. `git diff --check` exited 0.
