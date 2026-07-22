# Conventions

Rules agents get wrong on this project. Not a restatement of the linter.

## Manifest & permissions

- Manifest V3 only. No `background.page`, no MV2-era APIs; use a service worker if a background
  context is needed.
- Least privilege: add a permission only when a feature needs it, and justify it in the PR body.
  Never request `<all_urls>`. `host_permissions` and `content_scripts.matches` list explicit hosts.
- CSP: no remote code. Everything the extension runs is bundled in the package.

## Adapters

- One directory per provider under `src/adapters/{provider}/`. Export a single `ConversationAdapter`.
- All DOM selectors live in a `selectors` object at the top of the adapter — never inline in logic.
  A selector string appears exactly once so a site change is a one-line fix.
- `extract()` returns the normalized `Conversation`. It must not throw on a partially-rendered page
  without a clear message; if it cannot find messages, throw a typed extraction error the UI shows.
- Scraping a **virtualized list** (history sidebar, project list): STEP through it one viewport per
  round and accumulate rows across rounds into an id-keyed map — never jump to `scrollHeight` then do
  one final scan. A spacer-height recycling virtualizer keeps only a window of rows in the DOM, so a
  jump renders just the bottom window and a single scan drops everything in between. Test both models:
  a jump-to-bottom fake hides this bug — the fake must render only a `windowSize` window around the
  current `scrollTop` with the full height known up front (see `test/adapters/chatgpt/load-more.test.ts`).

## Exporters

- `src/export/*` consume `Conversation` only. No `document`/`window` DOM access — keeps them unit-testable.
- Markdown: deterministic output (stable ordering, escaped content). Same conversation → same bytes.
- Filenames: `{provider}-{safe-title}-{yyyymmdd}.{ext}`. Sanitize the title (no `/`, control chars).

## Naming & style

- Files/dirs: kebab-case. Types/interfaces: PascalCase. Functions/vars: camelCase.
- Prefer TypeScript once the build tool is chosen; until then, keep functions small and typed via JSDoc.
- User-facing strings centralized (one module) so i18n is a later drop-in, not a rewrite.

## Privacy invariant (enforce, don't just hope)

- No `fetch`/`XMLHttpRequest`/`sendBeacon`/`navigator.sendBeacon` to any external origin anywhere in
  adapter/export/content code. The download uses `URL.createObjectURL` + an `<a download>` (or the
  `downloads` API) — all local. Any PR adding a network call to these paths is rejected by default.

## Testing

- Exporters and the `Conversation` model are pure → unit-test them directly.
- Adapters depend on live DOM → test against saved HTML fixtures (`test/fixtures/{provider}/`), not
  the live site, so tests are deterministic. Capture a fresh fixture when a site's DOM changes.
