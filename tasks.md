# Claude history paging and return readiness
status: complete

## Scope
Finish the pending follow-up to PR #114 on `fix/claude-history-paging-and-project-guards`.
Preserve the measured history-row contract and project guards already on this branch.

## Acceptance criteria
- [x] Placeholder-only public history lists fail loud on `/chats` and `/recents`.
- [x] Spacers and Skeleton rows prevent premature loader completion; a capped walk preserves available chats and signals incomplete.
- [x] Home and member openers wait for readable rows without rewinding an already reached history route.
- [x] Final return restores the exact originating history alias, normalizes trailing slashes, and bounds retries.
- [x] Focused regression tests, full tests, lint, typecheck, version sync, and build pass.
- [x] Independent QA reviews the diff and reports evidence plus any live-browser verification limits.

## Out of scope
New selectors, account fixtures, conversation downloads, locale changes, store release, and merging PR #114.
The existing 1.14.3 version belongs to this unmerged PR; no additional version bump.

## Lint/test command
`npm test && npm run lint && npm run typecheck && npm run check:versions && npm run build`

## Verification notes
The 2026-10-05 loaded-extension smoke check predates this follow-up. It does not verify
the pending readiness and exact-home-return changes; deterministic navigation tests
cover those transitions without downloading user conversations.

Final local checks: 56 suites / 2,181 tests passed with locked Vitest 5.0.2;
lint, typecheck, version sync (1.14.3), build (Vite 8.3.1), and diff whitespace checks passed.
`npm ci --ignore-scripts` repaired stale installed tool versions without changing the lockfile;
`npm ls --depth=0` then passed. Build retains existing native-config and PDF chunk-size warnings.
Independent QA found no blockers and exercised history navigation, project guards, and
privacy/manifest tests. No live-browser or conversation-download verification performed
for this follow-up. Follow-up prepared for the PR #114 merge cycle.
