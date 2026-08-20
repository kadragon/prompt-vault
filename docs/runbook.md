# Runbook

> Build tooling: Vite + TypeScript + `@crxjs/vite-plugin` (decided in the design doc, scaffolded in
> ticket 1). Commands below are live.

## Environment

- Node `^20.19 || ^22.13 || >=24`, npm. (This is the ESLint 10 engines floor — the strictest of
  the dev deps; note the 22.x line needs **22.13**, not 22.12. Developed on Node 26.)
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
| Version sync check | `npm run check:versions` — asserts `package-lock.json` still carries `package.json`'s version. Fix drift with `npm install --package-lock-only` |
| Enable git hooks | `npm run hooks:install` (once per clone) — points `core.hooksPath` at the tracked `.githooks/`, whose `pre-commit` runs the version check. CI runs the same check, so the hook is a fast local warning, not the only gate |
| Package for store | `npm run package` → builds, then zips `dist/` → `prompt-vault-v<version>.zip` (repo root, gitignored). `--no-build` zips existing `dist/` as-is. Needs the system `zip` CLI. Upload the zip at the Web Store dashboard — see `docs/store-listing.md` |
| Release a build | Bump `package.json` (+ `npm install --package-lock-only`, `manifest.config.ts` reads the same version) on a branch and merge to `main`. `.github/workflows/release.yml` compares against the pre-push tip (`github.event.before`), re-runs `check:versions`/`lint`/`typecheck`/`test`, then `npm run package`, and publishes the zip as GitHub Release `v<version>` with generated notes (marked Latest only when it is the highest tag). Merges that leave the version alone publish nothing; an existing tag/release for that version is a no-op. Web Store upload stays manual — download the release asset |
| Regenerate icons | Edit `assets/icon.svg`, then render `public/icons/icon{16,32,48,128}.png` (see below) |

## Regenerate toolbar icons

Source of truth is `assets/icon.svg` (kept out of `public/` so it never ships). No ImageMagick /
Pillow / rsvg is installed in this environment, so rasterize via a headless Chromium canvas: load the
SVG into an `Image`, `drawImage` onto a `<canvas>` at each size, read `toDataURL('image/png')`, and
write the base64 to `public/icons/icon{size}.png` for sizes 16/32/48/128. `npm run build` copies
`public/icons/` verbatim into `dist/icons/`; the manifest references them via `icons` (extensions
list) and `action.default_icon` (toolbar). The display name/description are localized —
`__MSG_appName__`/`__MSG_appDesc__` resolve from `public/_locales/{en,ko}/messages.json`.

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
