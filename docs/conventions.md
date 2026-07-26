# Conventions

Rules agents get wrong on this project. Not a restatement of the linter.

## Manifest & permissions

- Manifest V3 only. No `background.page`, no MV2-era APIs; use a service worker if a background
  context is needed.
- Least privilege: add a permission only when a feature needs it, and justify it in the PR body.
  Never request `<all_urls>`. `content_scripts.matches` lists explicit hosts and is the only host
  grant — do not add `host_permissions`, which this extension does not need and which
  `test/privacy/manifest-least-privilege.test.ts` fails on (background in `manifest.config.ts`).
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
  `src/`. The download uses `URL.createObjectURL` + an `<a download>` (or the
  `downloads` API) — all local. Any PR adding a network call there is rejected by default.
- `test/privacy/no-external-network.test.ts` enforces this over all of `src/` in two halves:
  every JS/TS file (`.tsx?|jsx?|mjs|cjs`) is read and scanned for the forbidden primitives, and
  every `.html` file must load its scripts from a `src=` module — no inline `<script>`, which
  MV3's CSP forbids anyway and which the JS/TS half could not see. Adding executable code to
  `src/` in a form neither half reads reopens the gap; extend the gate in the same PR.

## Testing

- Exporters and the `Conversation` model are pure → unit-test them directly.
- Adapters depend on live DOM → test against saved HTML fixtures (`test/fixtures/{provider}/`), not
  the live site, so tests are deterministic. Capture a fresh fixture when a site's DOM changes.
- Fixtures freeze the DOM, so they cannot detect that the site's markup moved. Re-verify selectors
  against the logged-in live page per `docs/live-dom-verification.md`, and stamp the result.
- A test guarding a loop/scroll invariant must be **verified to fail** under a targeted
  neutralization of the exact guard it names — flip the condition, re-run, confirm red, revert.
  Nothing enforces this mechanically, and a loosely-bounded assertion (`toBeLessThan(rounds)`,
  where the bound has slack for a violation on every round) passes either way while reading as
  proof. Assert the shape the violation would actually produce instead — e.g. a duplicate
  progress count rather than merely "fewer ticks than rounds".
- **That verification expires when the fake changes.** A neutralization result is a property of the
  guard *and* the fake together, so editing the fake silently invalidates it. This has now bitten
  three times across adapters: a streaming test keyed to scroll position instead of elapsed time
  (Claude, PR #34); a paging test at two batches deep, where position-only termination collects
  everything by luck (Gemini, PR #37); and the same Gemini test again after the fake was taught to
  shift the viewport on a batch landing, which quietly turned it green. Re-run the neutralization
  for every guard whose fake you touched, in the same pass — not just for the guard you were aiming
  at. Corollary: when a shape is unmeasured (here, whether a landing batch moves `scrollTop`), model
  BOTH outcomes rather than picking one; a single arbitrary choice will silently stop testing
  whichever guard the other shape covered.
