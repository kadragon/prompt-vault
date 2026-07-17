# Runbook

> Status: greenfield. Commands below are the intended shape; fill exact scripts once the build
> tooling is chosen in the `plan` workflow. Values not yet decided are marked `[unknown]`.

## Environment

- Node `[unknown — set once package.json exists]`, npm.
- A Chromium browser (Chrome/Edge/Brave) for load-unpacked testing.

## Common commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Build extension | `npm run build` → outputs to `dist/` `[unknown until build tool chosen]` |
| Lint | `npm run lint` `[unknown]` |
| Unit tests (exporters, model) | `npm test` `[unknown]` |
| Package for store | `npm run package` → `*.zip` `[unknown]` |

## Load unpacked (manual test loop)

1. `npm run build` (or use the source dir directly if unbundled).
2. Chrome → `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select the build output dir (`dist/`) or the extension root.
4. Open a supported chat conversation, confirm the Download button appears top-right.
5. After code changes: click the **reload** icon on the extension card, then re-test.

## Failure modes

- **Button doesn't appear** — the page URL didn't match `content_scripts.matches`, or the site DOM
  changed and the adapter's mount point selector is stale. Check the adapter `selectors`.
- **Empty / truncated export** — long conversations may be virtualized (off-screen messages not in the
  DOM). Expected fail-loud behavior: a visible error, never a silent empty file. See `docs/architecture.md`.
- **Permission error on install** — a manifest permission is malformed or over-broad; check `manifest.json`.

## Scratchpad convention

Intermediate agent artifacts live in the session scratchpad dir (path in the system prompt), named
`{phase:02d}_{agent}_{artifact}.{ext}`. Ephemeral — gone at session end, no cross-session resume.
Delegation-gate evidence (if ever added) lives in `.claude/tmp/` (gitignored).

## Sweep trigger policy

Manual: run a harness/lint sweep between features. No CI yet (Level 1 harness); add a GitHub Actions
lint+build gate to reach Level 2.
