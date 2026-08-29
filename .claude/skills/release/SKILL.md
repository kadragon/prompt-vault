---
name: release
description: Cut a prompt-vault release — version bump, gates, GitHub Release, and the Chrome Web Store handoff — as one ordered cycle. Use when asked to package, bump the version, cut a release or tag, build the store zip, run the release workflow, or ship to the Web Store ("패키징 해줘", "버전 범프하고 다시 패키징", "릴리스 워크플로 돌려서 GitHub Release도 만들어줘", "배포하게 패키징", "스토어에 올리려고 하는데 최종 점검"). Not for an ordinary feature merge that leaves the version alone.
---

# Release cycle

The commands and their failure modes are **not** restated here — `docs/runbook.md` → *Common
commands* owns them (`Release a build` in particular), and `docs/store-listing.md` owns the
listing fields and the human-only dashboard checklist. This skill owns the **order and the
gates**, which is what kept getting reassembled one prompt at a time.

`package.json` is the single source of truth for the version. `manifest.config.ts` derives from
it; `package-lock.json` carries two stale copies that only `npm install` rewrites.

## Steps

**1. Scope the release.** `git log $(git describe --tags --abbrev=0)..main --oneline` — decide the
semver bump from what is actually in it. State the version and the reason in one line before
touching a file.

**2. Branch and bump.** Release prep is an implementation change, so branch (`git checkout -b
release/v<version>`); the `allow-main` marker covers planning and harness commits, not this. Edit
`package.json` only, then `npm install --package-lock-only`, then `npm run check:versions`. Never
edit the lockfile version by hand and never touch `manifest.config.ts`.

**3. Gate.** `npm run lint && npm run typecheck && npm test` must be green before anything is
packaged. A red gate ends the release; it is not a thing to work around.

**4. Delegate the two mandatory pre-release checks** (see `docs/delegation.md` — the routing table
owns the triggers, this is only the reminder that a release fires them):

- `product-evaluator`, always before a Web Store release.
- A live-DOM session when the diff since the last tag touches adapter code
  (`docs/live-dom-verification.md` — run its Step 0 enumeration, do not measure one thing).

**5. Merge to `main` via PR.** `.github/workflows/release.yml` fires on the push, re-runs
`check:versions`/`lint`/`typecheck`/`test`, runs `npm run package`, and publishes GitHub Release
`v<version>` with the zip attached.

**Never cut the tag by hand.** The push gate skips a version whose tag already exists, so a
hand-cut tag suppresses that version's release permanently, with a green job as the only signal.
`npm run package` locally is fine for inspecting a zip — it is not how a release is published.

**6. Confirm it published.** `gh release view v<version>` — the workflow is allowed to decide "no
release for this merge" and exit green, so a green job is not evidence. If the release is missing
because a tag already exists: **Actions → Release → Run workflow** on `main` with
`version=<package.json version>`. Dispatch is refused from any other ref, and refused when the tag
points at a different commit.

**7. Hand off the store upload.** Web Store submission is human-only. Give the user the
*Developer Dashboard — human-only* checklist from `docs/store-listing.md` and the release asset
URL. Do not report the release as shipped until they confirm the upload — the GitHub Release is
not the store.

## Korean copy

Store listing text, release notes, and announcement posts written in Korean go through the
`humanize-korean` skill before they land (AGENTS.md → Language Policy). Drafting them inline
reads as machine-translated.
