# Conventions

Rules agents get wrong on this project. Not a restatement of the linter.

## Manifest & permissions

- Manifest V3 only. No `background.page`, no MV2-era APIs; use a service worker if a background
  context is needed.
- Least privilege: add a permission only when a feature needs it, and justify it in the PR body.
  Never request `<all_urls>`. `content_scripts.matches` lists explicit hosts and is the only host
  grant — do not add `host_permissions`, which this extension does not need and which
  `test/privacy/manifest-least-privilege.test.ts` fails on (background in `manifest.config.ts`).
- CSP: no remote code, and no remote *subresources* either. `manifest.config.ts` declares an explicit
  `content_security_policy.extension_pages` — `script-src`/`object-src`/`img-src`/`media-src`/
  `font-src 'self'`, `style-src 'self' 'unsafe-inline'`, `frame-src`/`form-action`/`base-uri 'none'`
  — because MV3's default policy restricts executable code only and leaves
  `<img>`/`<iframe>`/`<form action>`/CSS `url()`/`@import` free to reach any origin. MV3 rejects
  `'unsafe-inline'` for `script-src` but accepts it for `style-src` (measured), and the options page
  needs it for its inline `<style>`. `connect-src` is deliberately unset (dev-mode HMR needs
  localhost) — reasons are in the manifest comment, and
  `test/privacy/manifest-least-privilege.test.ts` asserts each directive.

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
- `test/privacy/no-external-network.test.ts` enforces this in two halves. Every JS/TS file
  (`.tsx?|jsx?|mjs|cjs`) under `src/` is read and scanned for the forbidden primitives. Every
  `.html` file under `src/` is checked twice: each `<script>` must load a relative in-tree `src=`
  module (no inline body, no remote or out-of-tree source — either would run code the JS/TS half
  never read), and every **subresource** must resolve to a relative in-tree path too.
- The subresource scan covers the attributes a browser fetches from with no user action — `src`,
  `srcset`, `poster`, `data`, `action`, `formaction`, `href` on `<link>`/`<base>` — plus CSS `url()`
  and `@import` anywhere in the file. Two deliberate calls: `<a href>`/`<area href>` are NOT checked
  (user-initiated navigation, not a fetch, so a legitimate outbound link must not redden the gate),
  and `data:` URIs ARE rejected (no such URI exists in `src/`, and allowing the scheme would also
  admit `data:text/html`). The runtime control is the manifest CSP above; this half is the static
  backup — so when the two disagree, prefer closing the vector in BOTH, as the `@import` case was.
- A gate that hand-parses a format (HTML, JS) is only as good as its agreement with the real
  parser. Both detectors here accumulated false negatives that looked correct by inspection —
  five in the HTML half alone, every one found by running the payload through an actual parser
  (`happy-dom` is already a devDependency) and diffing its verdict against the detector's. When
  you touch either detector, probe it that way and pin the payload; reasoning about the regex
  is not verification. Over-reporting is the safe direction — a false negative is a hole.
- State the enforced scope precisely; it is narrower than the rule. Known residual: executable code
  in `src/` in a form neither half reads (a future `.json`/`.vue`/`.svelte`) reopens the gap —
  extend the gate in the same PR. Note also that both HTML halves read `src/**` only, so an asset
  referenced from `public/` (copied into `dist/` verbatim) is outside them; the CSP still covers it
  at runtime. Three subresource vectors the scan misses are tracked in `tasks.md` — an
  entity-escaped scheme, SVG `<image xlink:href>`, and `<meta http-equiv="refresh">`. The CSP covers
  the first two at runtime; the refresh has **no** runtime control, because Chrome dropped CSP
  `navigate-to`.

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
