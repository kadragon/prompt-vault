# Runbook

> Build tooling: Vite + TypeScript + `@crxjs/vite-plugin` (decided in the design doc, scaffolded in
> ticket 1). Commands below are live.

## Environment

- Node ≥ 22.12 (Vite 8 requires `^20.19 || >=22.12`; developed on Node 26), npm.
- A Chromium browser (Chrome/Edge/Brave) for load-unpacked testing.
- **TypeScript is pinned `~6.0.3` (< 6.1.0)** on purpose: `typescript-eslint` 8.x declares a peer of
  `typescript >=4.8.4 <6.1.0`, so bumping to TS 7.x breaks lint. Move TS forward only when
  `typescript-eslint` widens that peer range.

## Common commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Build extension | `npm run build` → outputs to `dist/` (Load unpacked this dir) |
| Lint | `npm run lint` (ESLint flat config + typescript-eslint) |
| Type-check | `npm run typecheck` (`tsc --noEmit`) |
| Unit tests (exporters, model) | `npm test` (Vitest, node env) |
| Package for store | `[unknown — added when Web Store submission is scoped]` |

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
