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
  `font-src`/`connect-src 'self'`, `style-src 'self' 'unsafe-inline'`,
  `frame-src`/`form-action`/`base-uri 'none'` — because MV3's default policy restricts executable
  code only and leaves `<img>`/`<iframe>`/`<form action>`/CSS `url()`/`@import`/`fetch`/`WebSocket`
  free to reach any origin. MV3 rejects `'unsafe-inline'` for `script-src` but accepts it for
  `style-src` (measured), and the options page needs it for its inline `<style>`. There is no
  `default-src`, so an unlisted directive is unrestricted, NOT defaulted — omitting one is a hole,
  not a shorthand. `test/privacy/manifest-least-privilege.test.ts` asserts each directive's source
  list **exactly**: substring containment catches a deleted directive but not a widened one
  (`img-src 'self' https://cdn.example` contains `img-src 'self'`), and widening is the likelier
  decay. None of this reaches a **content script**, which runs in the host page's world — that side
  is held only by the JS/TS half of the gate, which is why its forbidden list covers `WebSocket` and
  `EventSource` as well as `fetch`/`XHR`/`sendBeacon`.

## Adapters

- One directory per provider under `src/adapters/{provider}/`. Export a single `ConversationAdapter`.
- All DOM selectors live in a `selectors` object at the top of the adapter — never inline in logic.
  A selector string appears exactly once so a site change is a one-line fix.
- **Never pin a selector to a value the site localizes** — an `aria-label`, a button caption, any
  visible text. A measurement session runs in ONE UI language, so a localized value looks as solid
  as a structural one and silently kills the feature in every other language (Claude's sidebar was
  matched on `aside[aria-label="사이드바"]` for exactly that reason). Match the element and a
  structural fact about it instead, and record which half of the measurement is locale-independent.
  Fixtures inherit this: a test that hardcodes the localized string entrenches the bug rather than
  catching it, so at least one fixture must use a different locale's label.
- `extract()` returns the normalized `Conversation`. It must not throw on a partially-rendered page
  without a clear message; if it cannot find messages, throw a typed extraction error the UI shows.
- **Which route you are on is a question for the URL, never for a DOM query.** `main table` proved
  "still on the project home" until an assistant answer rendered a markdown table — after that the
  adapter skipped its return-to-home and failed every remaining item in the batch. Gate navigation
  on `matches`/`matchesProject`; use the DOM only to decide whether the page has RENDERED yet.
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

- No `fetch`/`XMLHttpRequest`/`sendBeacon`/`navigator.sendBeacon`/`WebSocket`/`EventSource` to any
  external origin anywhere in `src/`. The download uses `URL.createObjectURL` + an `<a download>`
  (or the `downloads` API) — all local. Any PR adding a network call there is rejected by default.
- `test/privacy/no-external-network.test.ts` enforces this in two halves. Every JS/TS file
  (`.tsx?|jsx?|mjs|cjs`) under `src/` is read and scanned for the forbidden primitives. Every
  `.html` file under `src/` is checked twice: each `<script>` must load a relative in-tree `src=`
  module (no inline body, no remote or out-of-tree source — either would run code the JS/TS half
  never read), and every **subresource** must resolve to a relative in-tree path too.
- The subresource scan covers the attributes a browser fetches from with no user action — `src`,
  `srcset`, `poster`, `data`, `action`, `formaction`, `background` — plus `href` and any prefixed
  `*:href` (the SVG 1.1 spelling is `xlink:href`) on every tag, the `url=` inside a
  `<meta http-equiv="refresh">` `content`, and CSS `url()` and
  `@import` anywhere in the file. Three deliberate calls: `href` is checked by **exclusion** rather
  than by an allowlist of fetching tags (see below), `<a href>`/`<area href>` are the exclusions
  (user-initiated navigation, not a fetch, so a legitimate outbound link must not redden the gate),
  and `data:` URIs ARE rejected (no such URI exists in `src/`, and allowing the scheme would also
  admit `data:text/html`). The runtime control is the manifest CSP above; this half is the static
  backup — so when the two disagree, prefer closing the vector in BOTH, as the `@import` case was.
- **`href` is an exclusion list, not an allowlist, and that asymmetry is the point.** The set of
  tags that fetch from `href` is not one anybody can enumerate correctly and keep correct: past
  `<link>` and `<base>` sit the SVG elements, where `<image>` and `<feImage>` fetch exactly like an
  `<img>` while `<use>`, `<pattern>`, the gradients and the animation elements resolve references
  whose off-document behaviour varies by browser and version. An allowlist has to get that boundary
  right or it leaves a silent hole — `<image xlink:href>` was one, missed by the `['link','base']`
  allowlist that shipped with the subresource scan in PR #42. Checking every tag
  but `<a>`/`<area>` turns each such misjudgement into an over-report instead, and costs nothing:
  a local relative path passes either way. Add to the exclusion list only for **navigation**, never
  because a tag is believed not to fetch. The attribute side follows the same rule: any `*:href` is
  matched by suffix, not an `['href','xlink:href']` set. Only `xlink:` reaches a real fetch — an
  HTML document binds no namespaces, so a rebound `xl:href` is an inert null-namespace attribute
  (measured) — but matching by suffix means nobody has to re-derive the parser's foreign-attribute
  adjustment table to trust this line.
- **`<meta http-equiv="refresh">` is the one vector with no runtime control behind it.** Everywhere
  else the manifest CSP is the primary control and this file is the backup; here the CSP restricts
  subresources and executable code only, and Chrome dropped the `navigate-to` directive, so no
  directive exists that would stop an automatic top-level navigation carrying whatever the URL
  interpolates. For this vector the static gate IS the control — weigh a change to
  `readMetaRefreshTargets` accordingly. Its `content=` parsing follows the HTML spec's shared
  declarative refresh steps loosely and always in the over-reporting direction (`url=` and the time
  both optional, `;`/`,` separators, `http-equiv` trimmed before comparing though a real parser does
  not trim). `content="0"` and an empty `url=` are same-document reloads and stay unflagged.
- **Reading one occurrence of an attribute is a hole when the tag has two.** A duplicate attribute
  is a tokenizer parse error that browsers resolve by keeping the FIRST and dropping the rest, so a
  helper that loops the attribute list and overwrites as it goes reads the wrong one:
  `<meta content="0;url=https://evil.example/" http-equiv="refresh" http-equiv="not-refresh">`
  navigates in a real parser and returned clean from the gate. Fixed by taking the **union** — any
  `http-equiv` reading `refresh` arms it, every `content` is classified — rather than mirroring
  first-wins, so the gate does not stay coupled to a tokenizer rule it cannot observe. `readSrcValue`
  is first-wins and the `URL_ATTRS` loop already classifies every occurrence, so both were fine; a
  new multi-attribute helper is the case to watch.
- **Classify the value the browser resolves, not the text in the file.** A raw-text scheme test is a
  false negative twice over, both measured: the HTML parser decodes character references first
  (`&#x68;ttps://…`, `https&colon;//…`), and the URL parser then strips ASCII tab/LF/CR from
  anywhere in the input (`ht<TAB>tps://…`). `isLocalInTreeSrc` therefore strips those characters,
  decodes numeric references, and rejects any value with a surviving `&` rather than implementing
  the named-entity table.
- **`srcdoc` is the attribute whose VALUE is a document, so the scan descends into it.** The tag
  scan resumes after each tag's own `>` precisely so a tag-shaped attribute VALUE
  (`<div data-html="<img src='https://…'>">`) is not re-matched as a real element — a real parser
  yields none, and that is pinned. `<iframe srcdoc>` is the one attribute where the same text IS
  parsed and DOES fetch: measured in Chrome against a local server, the raw
  `srcdoc="<img src='/a.png'>"` and the entity-encoded `srcdoc="&lt;img src='/b.png'&gt;"` each
  issued a real request for the nested image. `happy-dom` issues neither, so unlike every other
  vector here this one could not be settled by a parser diff — it needed a live browser, and the
  next claim about frame behaviour will too. The two shapes being indistinguishable by tag syntax is
  why the fix decodes the value and re-runs the whole collector on it rather than widening the tag
  scan. Three calls follow. The decode covers the five predefined NAMED references as well as the
  numeric ones — the opposite of `isLocalInTreeSrc`, where a surviving `&` is *rejected* and so
  over-reports, because a `srcdoc` left encoded yields no tags at all, a silent hole — and it is a
  SINGLE pass, since `&amp;lt;img …&amp;gt;` is literal text that a named-then-numeric two-pass
  decode would invent an element from. **Over-decoding is not the mirror of over-reporting — it is a
  hole.** Decoding a reference the parser leaves as TEXT injects a character into the nested markup,
  and a `>` or `'` there ends the tag's attribute list early, dropping a real `src=` that follows.
  Two shapes were found in review and measured fetching in Chrome while the first cut of this scan
  returned clean: `&gt=1` (WHATWG's *ambiguous ampersand* — no `;` and the next character is `=` or
  ASCII alphanumeric, so a reference inside an attribute is flushed as text; the historical rule that
  keeps `?a=1&lt=2` in a query string intact) and `&APOS;` (uppercase, which is simply not in the
  named-reference table — `&AMP;`/`&LT;`/`&GT;`/`&QUOT;` are, `&APOS;` is not). So the table is
  matched case-SENSITIVELY, the semicolon-less form is honoured only for the names that have one, and
  the carve-out is applied — but no further: a `&gt` at the END of a value is decodable and must stay
  decoded, or the closing `>` goes missing and the nested tag is never read at all, which is the
  opposite hole. `srcdoc` is read on **every** tag, not just `<iframe>`, for
  the same reason `href` is an exclusion list. And the recursion is capped at `MAX_SRCDOC_DEPTH`,
  where it **reports the unscanned nesting** instead of returning clean. Backstopped at runtime by
  `frame-src 'none'`, so here the static half is catching up rather than being the whole control. A
  `url()`/`@import` written unencoded inside a `srcdoc` is reported twice, flat and nested —
  duplicate over-reporting, not a miss, and pinned that way.
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
  at runtime. A remote SVG `<script href>` is caught, but by the `<script>` half and reported as
  `inline <script>` — the label understates it, and the test pinning that is what stops a later
  reader from "fixing" the label into a hole.

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
