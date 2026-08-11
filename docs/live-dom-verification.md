# Live-DOM Verification

Unit tests run against frozen fixtures, so they can never tell you that a provider's markup moved.
Only a session against the live, logged-in page can. Entries in each adapter's `selectors.ts`
should carry a `Verified against the live page (YYYY-MM-DD)` stamp — this doc is how that stamp
gets earned. Coverage is currently partial: some ChatGPT entries are stamped only `verified against
the captured fixtures` (weaker — a fixture cannot detect drift), and the oldest ones carry no
per-entry stamp at all, inheriting only the file header. Treat an unstamped or fixture-only entry as
unverified, not as verified-by-default.

Most of the procedure below was written for ChatGPT and reads that way; it applies unchanged to any
provider. Per-provider facts live in **Verified findings**, which is grouped by provider.

## When to run one

- An extraction regression is reported (empty/truncated export, buttons not mounting).
- A `[VERIFY]` item is open in `tasks.md`.
- A selector is added or changed in `selectors.ts` — the stamp must not be copied from a sibling.
- Before a Web Store release whose diff touches adapter code.

**Re-measure these numbers, not just the selectors.** A selector that stops matching fails loudly;
a *quantity* that drifts can silently weaken a guard built on it, so any session run for the reasons
above should re-check the ones adapter code depends on:

| Number | Where it is relied on | What drift does |
|--------|----------------------|-----------------|
| Gemini's initial page size (**10**, held at 11 / 16 / 17 / 31 exchanges) | `INITIAL_PAGE_SIZE`, the unwalkable-path threshold in `src/adapters/gemini/index.ts` | One-directional. A LARGER page size only over-triggers the guard (a complete page fails loud — safe). A SMALLER one under-triggers it: a conversation above the real page size but below 10 would be exported partially, silently, with nothing left to detect it. Gemini declares no total, so no code can catch this — only re-measurement. |
| ChatGPT `#history` raw page size (**28 rows**, zero variance across 72 full pages / 2 cold runs, 2026-07-28) | `pageParityGate` in `src/adapters/chatgpt/index.ts`, counted via `sidebarConversationRow` | The gate derives the size from the largest settled batch it observes rather than hardcoding 28, so a changed page size self-corrects. What drift breaks is the *shape*: the gate assumes a batch finishes growing before the next round, and classifies it then. If pages ever interleave, or hydration stretches a batch across a quiet round, a full page would read as short and the walk would settle early — silently. Re-measure the per-batch increment and its arrival pattern, not just the total. |
| ChatGPT `#history` page latency (**1509–7516 ms** confirmed, re-measured 2026-07-28; a 1502 ms minimum was seen but is unconfirmed as an inter-batch gap — was 1418–2830 ms on 2026-07-24) | `SIDEBAR_SCROLL_DEFAULTS` dwell, and the sizing of Gemini's `END_SETTLE_ROUNDS` | A slower backend than the dwell truncates silently on both providers. **No longer hypothetical** — measured 2026-07-25 at 725 of 852 conversations, silently, on the first Load more run (recorded below). The 2026-07-28 re-measurement found gaps above the shipped 5 s dwell in **both** runs (5 of 74 batches), so exceeding the dwell is not exotic — that is a count, not a claim about the tail's shape. |

## Tooling reality (read before promising anything)

The Playwright MCP server is **not repo-owned** — this repo checks in no `.mcp.json`. It comes from
a user-scoped Claude plugin (`playwright@claude-plugins-official`), configured with no flags —
`{"command": "npx", "args": ["@playwright/mcp@latest"]}`. On another machine or a fresh checkout it
may be absent or configured differently; confirm it is available before promising a live session,
and re-read its config rather than assuming the flags below.

- **The login now survives — corrected 2026-07-29.** This previously read "every session starts
  logged out", on the strength of `--help` saying a temporary directory would be created. Measured:
  a session opened straight onto a **logged-in** claude.ai *and* gemini.google.com with no login
  step performed at any point. Three facts were established, and the inference is left as one: the
  MCP config was re-read and is unchanged (`npx @playwright/mcp@latest`, still no `--user-data-dir`,
  still no `--extension`); the server that ran was **v0.0.78**; and persistent profile directories
  exist on disk under `~/Library/Caches/ms-playwright-mcp/mcp-chrome-*` (with older ones under
  `~/Library/Caches/ms-playwright/mcp-chrome-*`). Since nothing in the config asks for persistence,
  the server is evidently providing it — but *that v0.0.78 is the version which introduced it* was
  not tested. So plan for a live session **without** budgeting a login round trip, and re-check
  rather than assume: this is the server's behaviour, not something the repo pins or controls.
  Never try to reuse, read, or transplant
  the user's credentials; the profile persisting means their logged-in session sits on disk between
  runs, which is worth knowing before pointing the browser at anything sensitive.
- Two ways to make persistence explicit rather than incidental, **neither currently configured**
  (each needs an MCP config change, so propose it, don't assume it):
  - `--user-data-dir <path>` pinned to a stable directory, so the profile does not depend on the
    server's default.
  - `--extension` — attach to the user's already-running Chrome. Requires the "Playwright
    Extension" to be installed (Edge/Chrome only).
- **The MCP browser CAN run the unpacked extension** — corrected 2026-07-25, having been recorded
  here as impossible, which deferred four items on a false premise — three `[VERIFY]`s and one
  `[CONSTRAINT]`. The MCP config
  passes no `--load-extension`, but the browser it launches is an ordinary Chromium whose
  extensions page is available, so loading `dist/` by hand in the *running* browser works and the
  content script injects normally. **Read that narrowly:** what was measured is that the load
  *works*, not that it survives. Whether a hand-loaded unpacked extension outlives a browser restart
  is `[unknown — not measured 2026-07-29]`. It used to be inferred from the profile being temporary,
  but that premise was retracted by the login bullet above, so budget the by-hand load as a human
  step that *may* repeat each run and check rather than assume — what is automatable is everything
  *after* it. Three consequences, each measured in the sessions recorded below:
  - `chrome://extensions/` **is scriptable**. The extension's id, version and enabled state read
    out of `extensions-manager`'s nested shadow roots, and `#dev-reload-button` can be clicked to
    pick up a fresh `npm run build`. Be precise about what that buys, because it is less than it
    looks: the **version read proves almost nothing** — in the session below it was 1.7.0 both
    before and after the rebuild, since a `[DOCS]` change does not bump it — so what establishes
    which code is running is the build-then-reload *sequence*, not the number. And `npm run build`
    builds the **working tree**, so the sequence proves working-tree parity; that is HEAD parity
    only when the tree is clean, which is worth a `git status` if the distinction matters. Reload
    the *content* tab too: an extension reload orphans the content script already living in it.
  - **Exports are verifiable as real files.** Click a toolbar button and await Playwright's
    `download` event, then `saveAs` and measure on disk. This is the only route that also covers
    PDF, whose bytes come from pdfmake's own internal blob URL.
  - **Do not try to hook the export from the page.** Content scripts run in an **isolated world**,
    so a `URL.createObjectURL` patch installed via `browser_evaluate` never sees the extension's
    calls. DOM inspection of the mounted buttons is unaffected — they are ordinary page nodes.

  Two practical notes. `page.emulateMedia({ colorScheme })` really does move both apps' themes
  (Claude flips `html[data-mode]`, Gemini swaps `body.light-theme`/`dark-theme`), so light/dark is
  measurable rather than a matter of asking the user to toggle a setting. And mind where the
  account's own conversation content lands: write exports and screenshots **outside the repo**
  (Playwright puts element screenshots in the CWD, *not* in `.playwright-mcp/`), and note that the
  MCP server writes page snapshots and console logs into `.playwright-mcp/` on its own — those
  snapshots are full accessibility trees of whatever was open. That directory is gitignored, so
  nothing reaches a tracked file, but it is worth clearing after a session rather than leaving a
  transcript of the user's conversations on disk.

## The loop

1. User logs in; navigate to the target page (conversation, `#history` sidebar, or a project home
   page `/g/g-p-…/project`).
2. `browser_evaluate` a **self-contained** snippet that re-runs the shipped logic: copy the selector
   strings and the algorithm out of `selectors.ts` / the adapter rather than importing them, so
   drift surfaces as a mismatch instead of being masked.
3. Return **counts, ids, and booleans — never conversation text.** Keeps the evidence small and
   keeps private content out of the transcript.
4. Compare against ground truth visible on the page (sidebar count, turn count, titles).

## When the user drives their own browser

Recurring pattern: the user is on the live page and pastes DevTools console output back. Give them
**one** self-contained snippet that logs a single compact object, and ask for the whole output. Do
not ask for conversation content, and do not ask them to run several snippets in sequence — each
round trip costs them a turn.

Keep the snippet's syntax conservative, because a round trip is exactly what a syntax error costs.
On 2026-07-25 a probe using optional chaining came back `Uncaught SyntaxError: Unexpected token '.'`
— the signature a parser without `?.` produces — while `node --check` parsed the same text fine; a
rewrite with no `?.`, no `Object.fromEntries`, and no non-ASCII characters (a `…` inside a string
literal was the other suspect) ran first try. The exact cause was never isolated, so treat this as a
cheap precaution rather than a diagnosis: prefer `async`/`await`, arrow functions, `Array.from`, and
plain loops, and verify with `node --check` before sending.

## Recording the result

A verification that isn't recorded gets redone next month.

- Stamp the selector(s) in `selectors.ts` with the date and what was confirmed.
- Resolve the `tasks.md` `[VERIFY]` item with the evidence — concrete numbers, not "looks fine".
  A verification that *disproves* the premise is a result: say so and close the item.
- If the finding is not about a selector — a latency, a list's paging shape, which element actually
  scrolls — `selectors.ts` has nowhere to hold it, so copy it into **Verified findings** below
  *before* closing the item. `tasks.md` entries are deleted when the work lands; a measurement that
  adapter code now depends on must not leave with them.
- Commit `[DOCS]`.

**Dump the raw per-round record before tearing the session down, and reconcile the aggregates against
it.** Both halves cost something on 2026-07-28. The probe was closed after reading only summary
statistics, so when review asked whether that session's 1502 ms minimum was a genuine inter-batch gap,
the run's ordering was already gone and the question had to be recorded as unanswerable rather than
checked. Separately, an aggregate computed as deltas *between* stored records silently omits the first
interval — published as `35 × 1008 px` where the totals in the same table required `36`, and three
independent reviewers each flagged that the arithmetic did not close. Neither is a measurement problem;
both are bookkeeping. Keep the full per-round array until the write-up is reviewed, and check that every
per-unit figure reconciles with the totals printed beside it.

**The record must also hold the evidence gathered *outside* the measurement loop.** On 2026-07-29 the
environment checks behind a correction to this very file — the MCP server's `--version`, the three
`.mcp.json` copies, the on-disk profile directories — were run in-session but never written down, so
the resulting doc claim was unbackable from the record and an independent reviewer read it as
fabricated. Tooling, version and path facts feel like context rather than measurement, which is
exactly why they get dropped. Write them into the record with the DOM numbers: the test is not "did I
check this?" but "could someone holding only the record confirm it?"

## Verified findings

Results worth keeping after the `tasks.md` `[VERIFY]` item that produced them is closed — a
measurement of live behavior that adapter code now depends on. Numbers, not impressions; each
entry names the account scale it was measured at, because these are not scale-invariant.

## Manifest / permissions

*Not provider-specific — kept here because it is a live measurement of the loaded extension, and
this is where those live.*

### 2026-07-25 — `host_permissions` is not needed; the grant was dropped

Settled the `[CONSTRAINT]` "is `host_permissions` needed at all?". Resolved by experiment rather
than by argument, as the ticket required: a build with `host_permissions` removed was loaded
unpacked and exercised on the live, logged-in hosts.

**What the browser actually loaded.** Read directly from
`chrome-extension://<id>/manifest.json` — stronger evidence than the build-then-reload sequence,
because it is Chrome's own parse rather than an inference about which bundle is live:
`host_permissions` absent, `permissions: ["storage"]`, `content_scripts[0].matches` intact with all
four hosts. The extension listed as enabled with no error card.

**What still worked, per host** (single account, ~852 conversations):

| Host | Toolbar | Export |
|------|---------|--------|
| `chatgpt.com` | mounts, `placement=native`, 5 buttons (incl. bulk) | Markdown 716 B, real content. Bulk panel opens and enumerates 20 rows |
| `claude.ai` | mounts, `placement=native`, 4 buttons | Markdown 13,607 B; PDF 79,853 B, valid `%PDF-1.3` header |
| `gemini.google.com` | mounts, `placement=native`, 4 buttons | Markdown 15,049 B, real content |
| `chat.openai.com` | **not measurable** | — |

**`chat.openai.com` is a redirect-only origin.** `GET https://chat.openai.com/c/<id>` returns
**HTTP 308** to `https://chatgpt.com/c/<id>`. No document ever loads on that origin, so there is no
page for a content script to run in — with or without the grant. Read that precisely: this host was
**not** confirmed working, and it is **not** evidence that the removal is safe there. It is evidence
that there is nothing there to break. The `HOSTS` entry is consequently inert; whether to keep it is
a separate question (recorded as a follow-up), not something this experiment settled.

**Why the grant was redundant.** Under MV3 a *statically declared* content script injects on
`matches` alone; `host_permissions` additionally grants cross-origin fetch/cookie access **from an
extension context**. This extension has no such context: no background service worker, no
`fetch`/`XHR`/`sendBeacon` anywhere in `src/` — verified by grep across the whole tree, and
mechanically enforced over every JS/TS file in it by `test/privacy/no-external-network.test.ts`
(`SCAN_DIRS: ['src']`; `src/options/index.html` sits outside *that* half's file-type filter and is
covered by the HTML halves instead) — no `chrome.tabs`/`scripting`/`cookies`, downloads via
`URL.createObjectURL` + `<a download>`, PDF font base64-embedded. `npm run build` is `vite build`
only, so crxjs HMR — the one plausible build-time consumer — never applies to a shipped artifact.

The one non-obvious dependency, checked because it is the part that *could* have broken: crxjs
emits the content script as a small loader that dynamically imports the real bundle over a
`chrome-extension://` URL, which needs `web_accessible_resources`. It derives that block's
`matches` from the same `HOSTS` list feeding `content_scripts`, **not** from `host_permissions` —
confirmed in the built `dist/manifest.json`, whose `web_accessible_resources[0].matches` still
lists all four hosts after the removal. That is the mechanical reason the dynamic import kept
working, rather than it merely appearing to.

**What this does NOT buy.** The install-time warning is unchanged: Chrome derives host warnings from
`content_scripts.matches` too. The win is that the *granted* API surface shrinks to what is used.
Do not describe this to users as a reduced permission prompt.

The decision is now held mechanically by `test/privacy/manifest-least-privilege.test.ts` — re-adding
`host_permissions` turns it red, forcing a fresh measurement rather than a silent revert.

### 2026-07-26 — the extension-pages CSP blocks remote subresources, and breaks nothing

Settled the `[CONSTRAINT]` "the privacy gate checks HTML for `<script>` only". The static gate was
widened to every URL-bearing attribute, but the gate is a *review-time* control; this session
measured the *runtime* one that was added alongside it.

**What Chrome accepted.** `npm run build` at 1.7.2, then `#dev-reload-button` on the already-loaded
unpacked extension. It re-listed as **1.7.2, enabled, no error card** — which is the load-time
evidence that matters, because Chrome refuses to load an extension whose
`content_security_policy.extension_pages` is malformed or relaxes `script-src`/`object-src`.
`dist/manifest.json` carries the policy verbatim; crxjs does not rewrite it.

**What the policy actually blocks**, probed from inside the loaded options page
(`chrome-extension://<id>/src/options/index.html`):

| Probe | Result |
|-------|--------|
| `<img src="https://example.com/…?d=leak">` | **blocked** — `Loading the image … violates … "img-src 'self'"` |
| `<iframe src="https://example.com/">` | **blocked** — `Framing … violates … "frame-src 'none'"` |
| `<style>@import "https://example.com/…css"</style>` | **blocked** — `Loading the stylesheet … violates … "style-src 'self' 'unsafe-inline'"` |
| `fetch('https://example.com/…')` | **blocked** — `Connecting to … violates … "connect-src 'self'"` |
| `new WebSocket('wss://example.com/…')` | **blocked** — same directive; the constructor still returns, only the connection is refused |
| `new EventSource('https://example.com/…')` | **blocked** — same directive; surfaces as an `error` event, `readyState` 2 |
| `<img src="/icons/icon16.png">` (in-package) | loads |
| `fetch('/manifest.json')` (in-package) | loads — `connect-src 'self'` does not cost same-package reads |

Note the iframe's DOM event is a **`load`, not an `error`** — Chrome swaps in `about:blank` when
`frame-src` refuses. Only the console violation distinguishes blocked from loaded; do not read a
frame's `onload` as evidence the policy is off.

**`connect-src` was the omission worth re-measuring.** It was first left unset on the grounds that
crxjs's dev-mode HMR needs localhost — a justification that does not survive contact with this repo,
which has no `dev` script at all (`build` is plain `vite build`). With no `default-src`, an unlisted
directive is unrestricted rather than defaulted, so the three probes above were live egress from an
extension page until `connect-src 'self'` was added on review.

**`style-src 'self' 'unsafe-inline'` is accepted by MV3.** The inline allowance is rejected for
`script-src`, which is what made this worth measuring rather than assuming. It is required here (the
options page ships a 55-line inline `<style>`), and the `'self'` half is what closes the remote
`@import` above — a vector that the `url()` half of the static gate does not see either, so leaving
`style-src` unset would have left one path open in *both* layers.

**Nothing broke.** Computed style on the live page is `padding: 20px`, `font-size: 14px`, `fieldset`
border `1px` — the page's own inline CSS applies, and a rule injected into a fresh `<style>` took
effect too. Five checkboxes render and the title reads `prompt-vault 설정`, i.e. the module script ran
and `chrome.i18n` resolved, so `script-src 'self'` is satisfied by the bundled entry. Console was
clean before each probe and carried exactly the violation above after.

**Do not read the extensions-page error card as a load failure.** After probing, the item showed an
errors button — it holds the *runtime* CSP violations the probes just caused, not a manifest parse
error. A rejected `content_security_policy` fails differently: the extension does not load at all.
The load-time evidence is the item re-listing as enabled at the expected version.

Held mechanically by `test/privacy/manifest-least-privilege.test.ts`, which asserts each directive
by name — dropping `img-src` turns it red (verified by neutralization).

### 2026-07-26 — `chat.openai.com` redirects origin-wide; the inert `HOSTS` entry was dropped

Settled the `[CONSTRAINT]` follow-up the 2026-07-25 experiment above deliberately left open: the
`chat.openai.com` entry reached nothing, but "a 308 measured once is not proof the origin is
permanently redirect-only", so the entry was not removed on that measurement alone.

**Re-measured 2026-07-26**, and widened past what the first session checked:

| Request | Status | `location` |
|---------|--------|------------|
| `GET https://chat.openai.com/c/0000-test` | `HTTP/2 308` | `https://chatgpt.com/c/0000-test` |
| `GET https://chat.openai.com/` | `HTTP/2 308` | `https://chatgpt.com/` |

**The new fact is the second row.** The first session measured only `/c/<id>`, which is consistent
with a path-scoped rule; the bare root redirecting too means the redirect is **whole-origin**. There
is no page anywhere on that host, not merely no conversation page — so there is nothing a content
script could be missing out on, under any future URL shape OpenAI might route there.

**Method, stated precisely because it is weaker than the sessions elsewhere in this file:** plain
`curl` with a Chrome UA, no browser, no logged-in session. That is sufficient *for this claim* and
only this claim — a 308 is decided by the server before any document exists, so there is no DOM to
inspect and a browser would follow the same redirect by HTTP semantics. It is **not** evidence about
anything that needs a rendered page. Two sessions a day apart now agree, which is what raises this
above the single measurement the finding refused to act on.

**What changed.** `https://chat.openai.com/*` was removed from `HOSTS` in `manifest.config.ts`,
which drops it from both `content_scripts[0].matches` and the crxjs-generated
`web_accessible_resources[0].matches` (same source array — see the 2026-07-25 entry above). Golden
principle #2: a host reaching nothing is not the minimum needed, and it was charging real cost —
a line in the install-time host warning and a row in the Web Store permission justification.
`docs/PRIVACY.md` and `docs/store-listing.md` were updated to match.

**What deliberately did NOT change.** `SUPPORTED_HOSTS` in `src/adapters/chatgpt/matches.ts` still
lists the hostname. A JS constant carries no permission cost, and keeping it means restoring the
origin is a one-line manifest change if OpenAI ever stops redirecting. The asymmetry is commented on
both sides so it does not read as drift.

Held by `test/privacy/manifest-least-privilege.test.ts`, which asserts no declared `matches` pattern
mentions the host. Re-adding it turns that gate red on purpose: the correct way back is to
re-measure and restore with a new date, not to delete the assertion.

### 2026-07-26 — an `<iframe srcdoc>` really does fetch its nested subresources, in both spellings

Settled the premise the `[CONSTRAINT]` follow-up from the PR #44 review refused to build on: that
markup nested inside a `srcdoc` attribute fetches was *inferred from spec*, and the finding said so
and said "measure before fixing". This is the one privacy-gate claim `happy-dom` cannot settle — it
parses the nested document but issues no requests — so the usual parser diff was not available and a
real browser was needed.

**Measured 2026-07-26.** A page served from `python3 -m http.server` on `127.0.0.1`, loaded once in
Chrome via Playwright; the verdict is the server's own access log, not anything read out of the DOM:

| Markup on the page | Server logged a request |
|--------------------|-------------------------|
| `<iframe srcdoc="<img src='/nested-img-fetched.png'>">` | **yes** |
| `<iframe srcdoc="&lt;img src='/entity-encoded-img-fetched.png'&gt;">` | **yes** |
| `<img src="/control-top-level-img.png">` (control) | yes |

**The second row is the one that shaped the fix.** The entity-encoded spelling is how nested markup
is written so the *outer* document still parses — the form to expect, not the exotic one — and it
fetches identically. A decoder that handles only numeric references (as `isLocalInTreeSrc` does,
rejecting a surviving `&` instead of decoding it) would find no nested tag at all there, which is a
silent hole rather than the over-report that rejection buys everywhere else.

**Method, stated precisely:** a local origin and a plain HTTP server, no logged-in session and no
chat site involved. Sufficient *for this claim* and only this claim — whether the browser issues the
subresource request at all is decided by the frame's own parse, and a remote host would only add
DNS. It is not evidence about anything CSP-dependent: this probe ran on an ordinary web page, while
the extension's own pages carry `frame-src 'none'`, which blocks such a frame outright.

**What changed.** `findSubresourceViolations` in `test/privacy/no-external-network.test.ts` now
decodes a `srcdoc` value and re-runs the whole subresource collector over it — see the `srcdoc`
bullet in `docs/conventions.md` for the three calls that follow (named-reference decoding, single
pass, depth cap that reports rather than returns clean). The runtime control did not change and did
not need to; this is the static half catching up.

**Second round, same session — the fix's own decoder was measured too, and two shapes fetched while
it returned clean.** Raised in QA review, then confirmed the same way (Playwright + local server,
one page, four frames, verdict read from the access log):

| Markup inside `srcdoc` | Server logged a request |
|------------------------|-------------------------|
| `&lt;img data-x=1&gt=1 src='/gt-equals-fetched.png'&gt;` | **yes** |
| `&lt;img data-x=&APOS; src='/upper-apos-fetched.png'&gt;` | **yes** |
| `&LT;img src='/upper-lt-fetched.png'&GT;` | **yes** |
| `&lt;img src='/no-semicolon-tail-fetched.png'&gt` | **yes** |

Rows 1–2 were the hole. The first cut decoded named references case-insensitively and with the `;`
optional, so `&gt=1` became `>1` and `&APOS;` became `'` — each injecting a character the real parser
never produces, which ended the nested tag's attribute list early and pushed the live `src` outside
it. The scan returned `[]` for markup Chrome fetched from. **The lesson is the asymmetry:** for a
gate like this, over-*reporting* is safe and over-*decoding* is not — a wrong decode does not add a
false hit, it deletes a true one. Rows 3–4 are the guard rails on the fix: both are genuinely
decodable (`&LT;`/`&GT;` are real table entries; a semicolon-less `&gt` not followed by `=` or an
alphanumeric does decode), so a correction that simply stopped decoding would have lost the closing
`>` and read no nested tag at all — the opposite hole. All four are pinned as tests.

## ChatGPT

### 2026-07-24 — `#history` sidebar is append-only, not a recycling virtualizer

Measured on a 1042-conversation account. The rendered node count grew **monotonically from 28 to
1042** and always equalled the cumulative unique-id count (`windowed: false`) — rows are never
trimmed off the top at this scale. The accumulate-across-rounds logic in `loadMoreConversations`
guards a recycling path that this account never exercises; it stays correct and unit-covered, but
do not cite live evidence for it.

### 2026-07-24 — `#history` pages in from the server, at 1418–2830 ms per page

Same account. Four consecutive lazy batches were timed; every one cost a server round-trip in that
range. This is why the list loaders carry their own scroll tuning (`SIDEBAR_SCROLL_DEFAULTS` in the
adapter) instead of the message viewport's much shorter stall window. A patient replay (1500 ms per
step, 8 stable rounds) reached all 852 top-level `/c/` conversations (1042 counting project- and
GPT-scoped rows) and settled at the true bottom, confirming the list itself loads fine.

### 2026-07-25 — the bulk panel's rendered "Load more" done state, and a MEASURED silent truncation

First run of the **built extension**'s bulk panel (1.7.0, loaded unpacked into the MCP browser and
reloaded from a fresh `npm run build`; working tree clean, so `dist/` was at HEAD). Same
1042-conversation account as the 2026-07-24 entries. Opened from a conversation page's toolbar
(`data-prompt-vault-placement: native`, 5 buttons — 4 formats plus bulk). No export was run: this
session measured the load-more UI only. The profile's locale rendered every `chrome.i18n` string in
Korean; labels below are quoted by their English message values (`bulkPanelLoadMore`,
`bulkPanelLoadMoreDone`, …), as the other provider sections do.

The panel opened with **19 rows** (the `#history` rows rendered at load, plus its select-all
checkbox — a structural detail worth stating because a `div > label > input` selector counts 20).
Three rows were checked, then "Load more" was clicked repeatedly:

| Run | Rows before → after | Progress line reached | Settled button | Status line | Checked |
|---|---|---|---|---|---|
| 1 | 19 → **725** | 725 | `Load more`, **enabled** | cleared to `''` | 3 |
| 2 | 725 → **852** | 852 | `Load more`, **enabled** | cleared to `''` | 3 |
| 3 | 852 → 852 | 852 | **`All conversations loaded`, disabled** | cleared to `''` | 3 |

**Run 1 truncated at 725 of 852 — 127 conversations, 14.9%, missing with no error.** 852 is ground
truth: it matches the top-level `/c/` count measured 2026-07-24, and it is where runs 2 and 3
converged. Run 1 did not fail — it cleared its status line and re-enabled the button, exactly as a
complete run does. This is the **first measured instance** of the residual hazard the review backlog
records as theoretical (a `#history` page slower than the 5 s dwell — `SIDEBAR_STABLE_ROUNDS 10` ×
`SIDEBAR_STEP_DELAY_MS 500`). Be precise about what was and was not established: the *outcome* is
measured, the *mechanism* is not. Nothing here isolated which exit fired (dwell expiry vs
`endOfListGate`), and no per-round timing was captured. What is certain is that the exit was
**silent** (AGENTS.md #4).

Rate, for sizing future dwells: the progress line climbed at roughly 5–10 conversations/second
(19→213 in ~20 s; 388→725 over ~64 s), so the walk is not uniformly slow — a stall long enough to
end it is a local event at one page boundary, not a slow link.

**The done state itself is correct, and reaching it is stronger evidence than one run.** Run 3 grew
nothing, which is the only path to `All conversations loaded` + `disabled` — so a user who clicks
until the button disables has survived one more full walk than a user who clicks once. It is **not**
a completeness oracle: a confirming run that stalls at its first page boundary also grows nothing
and would latch the same done state falsely. It strengthens the guarantee; it does not prove it.

Everything the `[VERIFY]` item asked about held at the done state, on 852 rows:

| Measurement | Result |
|---|---|
| Load more label / `disabled` | `All conversations loaded` / **true** |
| Rows / distinct ids / duplicates | 852 / 852 / **0** — the `seen` dedupe held across three runs |
| Pre-load selection preserved | **yes** — exactly the 3 ids checked before run 1, 0 missing, 0 extra |
| Export button | `Export 3 selected`, enabled |
| Select-all | unchecked (correct: 3 of 852) |
| Status line | `''` |
| Cancel | still `Cancel`, enabled — never repurposed to `Close`, since no batch ran |
| Row DOM order vs checkbox order | identical |

Selections survived **two** list growths (19→725→852), not one, so preservation is not an artifact of
a single append. Scope limit: one account, one track (`#history`; the project-home track was not
exercised), and no export was run from the loaded list.

### 2026-07-28 — the raw `#history` page is exactly 28 rows; the `/c/` increment is not it

Settled the blocker on the review backlog's `[FIX]` (the silent-truncation residual), which asked for
"a live-DOM measurement of the raw `#history` page size and whether it is stable". It does **not**
close that item — the page-size-parity oracle is now unblocked, not implemented.

**Method.** Playwright MCP against the live logged-in page; a probe reproducing the adapter's
`findScrollableAncestor`, `stepDown` and `endOfListGate` from copied strings (not imported). Cadence
was deliberately **patient — 1500 ms per step, 8 stable rounds (12 s dwell)** — against the shipped
500 ms × 10 (5 s): measuring what causes a truncation with a walk that can itself truncate would beg
the question. **Two independent cold runs** (the second in a *new tab*, since a re-`goto` is not a
cold load), same account, ~1047 rows.

| | Run 1 | Run 2 |
|---|---|---|
| Rows at cold load | **28** (19 `/c/`, 9 scoped) | **28** (19 `/c/`, 9 scoped) |
| `scrollHeight` at cold load | 1508 | 1508 |
| Batches observed | 37 | 37 |
| Raw increment per batch (`dAll`) | **36 × 28**, then 1 × 11 | **36 × 28**, then 1 × 11 |
| `scrollHeight` increment per batch | **36 × 1008 px**, then 1 × 396 px | **36 × 1008 px**, then 1 × 396 px |
| Rows at rest | **1047** (857 `/c/`, 190 scoped) | **1047** (857 `/c/`, 190 scoped) |
| `scrollHeight` at rest | 38192 | 38192 |
| Rounds / wall clock | 106 / 159 s | 104 / 156 s |
| Exit | settled (`stable`) | settled (`stable`) |

**The page size is 28 rows: all 72 full pages measured exactly 28**, across 74 batches in two runs —
the only other value being each run's terminal short page of 11. Both runs landed on the identical
endpoint, and the geometry says the same thing independently: 1008 px per full page is 28 × 36 px, and
the short final page's 396 px is 11 × 36 px. The arithmetic closes exactly — 28 (initial) + 36 × 28 +
11 = 1047. Treat the 36 px row height as incidental; it is the *ratio holding* that is the evidence,
not the pixel value.

**A row is one `<li>`, one `<a href>`.** At rest `li` and `a[href]` were both 1047 with `other: 0`
(no non-conversation anchors inside `#history`). **Mid-fetch they diverge** — 1039 `li` against 1036
anchors, 871 against 868. Measured: 3 `li` carried no anchor at both mid-fetch samples, and none did at
rest. *Inferred*, and not directly observed: that those are placeholder rows for a pending page which
reconcile once it lands — headers, separators or partially-rendered rows fit the same samples, and the
delta being 3 against a 28-row pending page is unexplained under either reading. The directive stands on
the counts alone: an oracle counting `li` would read a phantom increment, so **count anchors** —
subject to the hydration caveat below, which cuts the other way.

**Why the loader cannot see this today, stated as measured numbers.** The per-batch increment in
*top-level `/c/` ids* — what `collectConversations` counts — ranged **11 to 27** and was never once
28:

| Increment | Raw rows (`a[href]`) | Top-level `/c/` only |
|---|---|---|
| Distinct values across the same 74 batches | **2** — 28 on all 72 full pages, 11 on the 2 terminal pages | **13** (11…27) |

This is the premise the backlog item recorded as the reason parity was unusable, now measured rather
than inferred: the 190 project/GPT-scoped rows are interleaved unpredictably, so the `/c/` delta is a
*sample* of a 28-row page, not its size.

**What this buys the oracle — and the two things it does NOT buy.** "Last increment == 28 ⇒ another
page exists" is sound but **asymmetric, and that asymmetry is the whole point**: a short page (the
terminal 11 here) proves exhaustion, while a *full* page proves nothing either way. Read the rest of
this paragraph before building on that, because the naive form of the rule — "keep pulling until a
page arrives short or empty" — has a hole at each end, both raised in review on this PR and both
consistent with the numbers above.

- **An empty page is not observable by counting rows.** A list whose total is an exact multiple of 28
  ends on a *full* page, so only the following empty one reveals the end. But zero new anchors is
  exactly what an in-flight page and a >5 s stall also look like — the very ambiguity this task exists
  to remove. So parity gives a **definitive** terminal signal only when the total is not a multiple of
  the page size; on a multiple it degrades to today's dwell heuristic. It narrows the hazard, it does
  not close it, and nothing measured here supplies the missing completion signal.
- **A full page can transiently present as short.** The mid-fetch divergence above is the mechanism:
  anchors lag their rows, so sampling during hydration can show a 28-row page as an increment of 25.
  At the shipped 500 ms cadence that is a live risk, and "short ⇒ exhausted" firing on it would
  **recreate the silent truncation the guard is for**. Any implementation must require the increment
  to settle (or read a loader-completion signal) before classifying a batch as short — counting
  anchors instead of `li` avoids a phantom *extra* row but introduces this phantom *missing* one.

**Latency, re-measured (the row in "Re-measure these numbers" above).** Inter-batch gaps: min
**1502 ms** (see the caveat — treat **1509 ms** as the confirmed floor), median **3011–4504 ms** (one
per run), max **7516 ms**. The caveat on the minimum: each run's *first* record is timed from page load
rather than from a preceding batch, so it is not strictly an inter-batch gap. Run 2's minimum was an
interior record (1509 ms at round 5) against a first record of 3002 ms, so that run's floor is clean;
run 1's per-batch ordering was not retained, and since the global 1502 ms sits *below* run 2's interior
minimum it can only have come from run 1 — **so 1502 ms is unconfirmed as an inter-batch gap**, while
the 7516 ms upper bound is directly measured. **Gaps exceeding the shipped 5 s dwell occurred in both
runs** — 3 of 37 and 2 of 37, i.e. **5 of 74 batches** — and every one of them landed while the
container was already clamped (`settled: true`), which is the exact state `scrollUntilStable` counts
stalls in. That establishes exceeding the dwell is **not exotic**; 5 samples say nothing about how the
tail is shaped, and no distribution claim should be read into them.

Be precise about what that is and is not. It measures that **the server stalls longer than the
shipped dwell, routinely, on a healthy list** — the hazard is not exotic. It is **not** a measurement
of the shipped loader: this probe ran at 1500 ms per round, and mapping a 7516 ms stall onto the
shipped 500 ms × 10 rounds is arithmetic, not observation. The 2026-07-25 truncation (725 of 852)
remains the only *measured* instance of the outcome, and which exit fired there is still not isolated.

Scope limits: one account, one track (`#history`; the project-home list was not exercised), one
window size (`clientHeight` 747). The page size is established at ~1047 rows, not at other scales.
Incidentally, the totals moved from the 2026-07-24 session's 1042 rows / 852 `/c/` to **1047 / 857** —
five conversations added in the interval, not a contradiction between sessions.

### 2026-07-24 — project home scroll port is taller than the list it contains

On `/g/g-p-…/project`, `projectListSection` resolved the `<main>` `<section>` correctly (the
left-nav expando was excluded: 5 links in the document, 5 in the section). `findScrollableAncestor`
skipped every `overflow-y: visible` ancestor and, once the page overflowed, resolved the **stage**
scroll port — `overflow-y: auto`, `scrollHeight 730 > clientHeight 400`, merely *containing* the
section — with `stepDown` moving it 0→330. A downward walk therefore cannot assume the container's
arithmetic bottom is the list's end; see `endOfListGate` in the adapter. `.text-sm.font-medium`
extracted 5/5 titles with no `'ChatGPT conversation'` fallbacks and no preview-snippet mis-picks.

## Claude

### 2026-07-25 — the message list IS a recycling virtualizer (unlike ChatGPT's `#history`)

Measured on a ~50-turn conversation, via a console snippet the user ran on the live logged-in page.
Rendered turn nodes (`[data-testid="user-message"]` + `.standard-markdown`) numbered **16 at the
bottom (7 user + 9 assistant)** and **8 after scrolling to the top (3 + 5)** — the count *fell*, and
surfaced different turns, so nodes are trimmed off both ends rather than accumulated. Across the
walk, **50 distinct `data-index` values** were surfaced.

This is the opposite of the `#history` finding above, and it is the reason `extract` for Claude
cannot be a one-shot `querySelectorAll`: such a read would have captured 16 of 50 turns — a **68%
silent truncation** (AGENTS.md #4). Do not generalize either provider's virtualization model to the
other.

### 2026-07-25 (second walk) — `data-index` is 0-based and dense

Measured on a **56-row** conversation, via a console snippet that reproduced the adapter's
up-then-down walk and censused every row it saw. `minIndex 0`, `maxIndex 55`, `indexedRows 56`,
`contiguous true`, no gaps. The numbering therefore starts at zero and skips nothing, which is what
lets `buildMessages` treat a collected range starting above 0 as a hole rather than an offset —
contiguity alone cannot distinguish "turns 1…n" from "turns 0…n−1".

Scope limit: one conversation. It is evidence that the index IS 0-based, not that a first row can
never be something other than a turn — and the finding below shows non-turn rows exist.

### 2026-07-25 (second walk) — not every indexed row is a readable turn

Same conversation. Turn nodes per indexed row came out as **54 rows with 1, one row with 4, one row
with 0**. This disproves the first session's "exactly one turn node per indexed row", which rested on
a 50-turn conversation in which no row happened to hold more than one turn node — *why* it did not is
unknown, since that session never recorded what kinds of turn it contained. Both off-nominal shapes
are real at ordinary scale, so neither the walk nor `buildMessages` may assume 1:1.

- **The 0-turn row (index 50) is an attachment-only user turn.** It matched neither
  `[data-testid="user-message"]` nor `.standard-markdown` anywhere in its subtree — the user-message
  node is **absent**, not present-and-empty. A second, structure-only dump of that row (text nodes
  redacted to lengths) gave the markup:

  ```
  div[data-index="50"] > div[role="article"] > … > div.gap-2.mx-0.5.mb-3.flex.flex-wrap.justify-end
    > div.group/thumbnail.relative
      > div[data-testid="<file name>.pdf"].rounded-lg…cursor-pointer  (120×120 inline size)
        > button > img[alt="<file name>.pdf" src="/api/…/files/…/thumbnail"]
  ```

  Two places carry the file name: the tile's `data-testid` **value**, and the thumbnail's `alt`. The
  adapter reads `alt` — a test id whose value is user data is not a contract, while `alt` is the
  standard accessible name.
- **Mechanism note:** this is a *different* failure from the one `tasks.md` predicted. The prediction
  was an empty `user-message` yielding "some turns could not be read"; in reality position 50 is
  claimed by no turn at all, so it surfaces through the **gap** branch of `buildMessages`. Either way
  it was loud, not silent (AGENTS.md #4) — but it blocked export of the whole conversation until the
  attachment path landed.
- **The 4-turn row (index 55) is an assistant turn.** Four sibling `.standard-markdown` containers,
  each alone in its own wrapper (`prevSibTag: null`), text lengths 52 / 25 / 29 / 323. It carries
  `action-bar-copy`, `action-bar-read-aloud`, `action-bar-retry` and no `user-message`. The adapter's
  existing join-nodes-within-a-row path handles it, so all four blocks export.
- **Unverified:** what those four blocks *are* — extended thinking, tool calls, and artifacts were the
  hypothesis, but nothing in the row distinguishes them, so it is not established that any of those
  three features was present in the measured conversation at all. What IS established: a multi-block
  assistant turn exists and exports intact.
  **Partly settled 2026-07-29** (see the entry below): expanding a turn's extended-thinking block
  adds a second, un-nested `.standard-markdown` to the row, which is one way a multi-block row
  arises — and one the join path exports as message content. It does not establish that *this* row's
  four blocks were thinking; a four-block row was not reproduced.

### 2026-07-25 (second walk) — role is decidable from the action bar, and `aria-setsize` declares the total

Same conversation. Partitioning every `data-testid` in the 54 single-turn rows by the role of the
turn they contained:

| Scope | Test ids |
|-------|----------|
| User only | `user-message`, `action-bar-edit` |
| Assistant only | `action-bar-read-aloud`, `action-bar-retry` |
| Both | `action-bar-copy` |

`action-bar-edit` being user-exclusive is what lets an attachment-only row — which has no
`user-message` node — be attributed to the user without guessing. Scope limit: measured on one
conversation, and Claude could plausibly add an edit affordance to assistant turns; the adapter
therefore uses it only to *claim* an otherwise-unreadable row, never to override a turn node's own
role, so a change degrades to the pre-existing loud failure.

Separately, the row dumped in full wrapped its message in **`div[role="article"]` carrying
`aria-setsize="56"` and `aria-posinset="51"`** (1-based, against a 0-based `data-index` of 50). The
`aria-setsize` value matched the observed row count exactly, which made it a **candidate**
completeness oracle — stronger than the contiguity check, which even after the leading-range check
added 2026-07-25 still cannot detect turns missing off the *trailing* end.

Nothing more was claimed at the time: only one row had been dumped, so presence on every row was
unverified, and 56 is a count of *rows*, not messages. The session below settled all of it.

### 2026-07-25 (third session) — `aria-setsize` is a usable declared row total

Measured through Playwright MCP against the live logged-in page, driving a probe that reproduced the
adapter's up-then-down walk from copied selector strings. **Four conversations were walked end to
end**, and twelve more spot-checked. This session promotes the candidate above into something the
adapter depends on, so the numbers matter:

| Conversation | Rows | Rows carrying `aria-setsize` | Distinct values across the walk | `maxIndex + 1` | Turn nodes | Nodes per row | Rounds |
|---|---|---|---|---|---|---|---|
| A | 56 | 56 | `[56]` | 56 | 58 | 54×1, 1×4, 1×0 | 50 |
| B | 14 | 14 | `[14]` | 14 | 14 | 14×1 | 74 |
| C | 16 | 16 | `[16]` | 16 | 16 | 16×1 | 68 |
| D | 26 | 26 | `[26]` | 26 | 27 | 25×1, 1×2 | 60 |

- **Present on every indexed row** — 112/112. `rowsArticleNoSetsize` and `rowsNoArticle` were both
  **0**, so there is no row with a `role="article"` lacking the attribute, and no indexed row without
  an article at all. That includes conversation A's attachment-only row 50, which has no
  `[data-testid="user-message"]` node whatsoever. Twelve further conversations spanning 2…56 rows
  were spot-checked on load and every one carried it.
- **Constant for the duration of a walk** — exactly one distinct value per conversation, across 50 to
  74 record rounds each.
- **It counts ROWS, not messages.** A and D are the proof: 56 rows against 58 turn nodes, 26 against
  27, because a row may hold several assistant blocks. Where the two differ, the declared total
  tracked the rows. This is what makes it comparable with the `data-index` set the adapter collects.
- `aria-posinset − data-index === 1` on all 112 rows: 1-based against a 0-based index, no exceptions.
- **It tracks the live list.** In a conversation created for the test, the declared total went **2 →
  4** across one exchange. Across 60 samples at 300 ms spanning a streaming response, the declared
  total, the rendered row count and the `role="article"` count never disagreed.
- **No low value during hydration.** Sampling every 100 ms across an SPA navigation into
  conversation A: the previous conversation's rows (4, declaring 4) are gone by the 100 ms sample,
  every sample from 100 ms to 600 ms sees **zero** `role="article"` elements, and at the 700 ms
  sample rows are present already declaring 56. So the gap is ~600 ms of nothing, not ~600 ms of a
  smaller number: there is no partial state inside a conversation to latch onto, which is what makes
  reading the *smallest* declared total safe.

`buildMessages` now fails loud when fewer rows were collected than the declared total. The adapter
reads the **smallest** total observed during a walk: since the total tracks the live list, a message
arriving mid-export raises it, and reading the largest would fail an export over turns that did not
exist when it began. That costs nothing in the case the check exists for — a walk that stops short
sees the true total on every row it did reach.

#### A declared total is an oracle, not a termination condition

Worth recording because it is the non-obvious half, and it cost this branch a P0 before review caught
it. Ending the walk once every declared position is filled looks like the natural use of the number
and is wrong: a position being *filled* is not a turn being *finished*.

The bottom turn of a still-streaming response is captured as a fragment in the walk's first round.
The walk then moves up and the virtualizer **recycles that row out of the DOM** — after which no
later round can grow it, because the adapter can only re-read rows that are rendered. A "have we
collected everything?" test is therefore satisfied at the top of the conversation, where the
streaming turn does not exist in the DOM at all, and a walk that stopped there would never return to
the bottom. Adding a quiescence requirement does not save it: "no turn grew this round" is equally
true when the growing turn is off-screen. Measured on the test fake at 20 turns against a 250 px
viewport: the early-exit version ended at round 17 and exported a 4-character fragment, where the
unmodified walk ran 32 rounds and exported the whole answer — with the full suite green.

So the walk still runs both passes to their scroll ends, and the downward pass — which finishes at
the bottom, where streaming happens — is what gives the last turn its final sighting. Pinned by two
tests in `test/adapters/claude/collect-virtualized.test.ts`: one that exports a recycled streaming
turn in full, and one asserting the walk takes the *same* number of rounds with a declared total as
without. A real termination condition needs a stream-completion signal, which has never been
measured; tracked in `backlog.md`.

Incidental, and NOT the scope of this session: `minIndex` was **0** in all four walks, which
re-measures on n=4 the 0-based rule `buildMessages` had generalized from a single conversation.

### 2026-07-25 — Claude's structural facts, as used by `src/adapters/claude/selectors.ts`

Same session. Conversation URLs are `claude.ai/chat/<uuid>`. Facts the adapter depends on:

- **Only the user side is labeled.** `[data-testid="user-message"]` marks user turns; assistant
  turns carry no test id, so the adapter identifies them by their prose container
  `.standard-markdown` and takes document order as the interleaving. The two sets are disjoint —
  zero `.standard-markdown` elements are nested inside a user turn.
- **No per-message id.** There is no `data-message-id` analogue. The virtualizer row's `data-index`
  is the only stable per-turn identity, which is why it serves as the dedupe key, the sort key, and
  (via contiguity) a completeness oracle — something the ChatGPT adapter has never had.
- **Scroll port is attribute-addressable**: `[data-autoscroll-container]`, so no class-soup
  selector is needed. It was the only content scroll port (`scrollHeight 2922 > clientHeight 592`).
- **`.markdown` and `[class*="prose"]` resolve to zero elements** — no ChatGPT selector transfers.
- **Code fences declare their language on the `<code>`**: `class="language-sql"`, with no header
  label. ChatGPT is the reverse (header label, no class), so `codeLanguage()` in
  `src/core/html-to-markdown.ts` reads the class first and falls back to the label.
- **User turns preserve newlines**: the body is `p.whitespace-pre-wrap`, so user content must NOT
  be pushed through the serializer's whitespace-collapsing inline path.
- **`document.title` is `"<conversation title> - Claude"`** — the suffix is stripped to recover the
  title.
- **Header bar**: `[data-testid="wiggle-controls-actions"]` had `childCount 1` and
  `contains(shareButton) === true`, so the export buttons can be inserted ahead of Share rather
  than replacing it.
- **Native button classes** (the source of `TOOLBAR_BUTTON_CLASS`), captured in full from the
  Share button:

  ```
  cds-reset group/btn relative isolate inline-flex shrink-0 items-center justify-center gap-1.5
  whitespace-nowrap select-none cursor-[var(--cds-cursor-interactive)] aria-disabled:cursor-default
  data-[disabled]:cursor-default border-0 outline-none focus-visible:outline-hidden rounded
  h-control font-sans text-body font-medium [&:disabled:not([aria-busy])]:opacity-50
  disabled:pointer-events-none transition-shadow duration-fast focus-visible:shadow-focus
  text-primary aria-pressed:text-accent px-md
  ```

  The adapter uses two subsets of this one capture. `TOOLBAR_BUTTON_CLASS` (the conversation
  header's icon-only export buttons) drops exactly `px-md` — a *labeled* control's padding — and
  `aria-pressed:text-accent`, a toggle style; every other token, `disabled:` variants included, is
  kept. `LIST_TOOLBAR_BUTTON_CLASS` (the project / `/recents` "Download all" triggers) keeps
  `px-md`, since those buttons ARE labeled, and drops only `aria-pressed:text-accent`. A class
  string is the one kind of captured value nothing
  type-checks, and an embellished token would surface only as unstyled buttons on the live page —
  so `test/adapters/claude/toolbar-mount.test.ts` pins every token of `toolbarButtonClass` to the
  fixture's reproduction of this string. Keep the fixture's copy FULL; abbreviating it turns that
  guard into a tautology.

### 2026-07-25 (fourth session) — the shipped extension's own walk, on the real virtualizer

Everything above was measured with probes that *copy* the adapter's selectors and algorithm. This
is the first run of the **built extension** (1.7.0, loaded unpacked into the MCP browser, reloaded
from a fresh `npm run build` before measuring), on a 56-row conversation opened cold.

| Measurement | Result |
|---|---|
| Rows rendered at fresh load | **6** (8 turn nodes) against a declared `aria-setsize` of **56** |
| Exported JSON `messages` | **56** — equal to the declared row total |
| Roles | 28 user / 28 assistant, strictly alternating |
| Messages with empty content | 0 |
| Messages exported as `[File: …]` | **1** |
| Rows rendered after the export | 17, `data-index` 39…55 |
| `scrollTop` before / after | 8486 / 8486 |
| `scrollHeight` before / after | 9381 / 10545 |
| Wall clock per export | json 7.5 s · md 7.0 s · pdf 7.3 s · html 7.0 s |
| Downloads produced | 4 real files — json 16,448 B · md 13,607 B (60 headings) · pdf 79,853 B (`%PDF-` header present) · html 16,256 B (`<html>` present) |

- **`messages` equalled `aria-setsize` exactly**, so the walk reached every row. `buildMessages`
  fails loud on a shortfall against the declared total, which makes a *successful* export already a
  completeness proof; the equality is the stronger form of the same statement.
- A one-shot `querySelectorAll` on that cold load would have exported **6 of 56 rows** — 8 turn
  nodes. That 6 was read twice, by two probes seconds apart, so it is not one instantaneous
  sample; no settle delay was applied beyond waiting for the toolbar to mount.
- The 68% figure recorded further up is **not directly comparable**, and the reason is worth
  stating rather than glossing. It counted *turn nodes* (16 of ~50) where this counts rows, it came
  from a different conversation, and neither session recorded the conditions its number was sampled
  under. Here a cold load rendered 8 turn nodes across 6 rows, while a **post-walk bottom rendered
  17 rows at the very same `scrollTop`** — so the earlier 16 is consistent with either an
  already-scrolled page *or* a virtualizer window warmed by walking, and nothing measured
  distinguishes the two. Both numbers support the only claim that matters — a one-shot read loses
  most of a long conversation — so use them as two independent instances of it, not as a trend.
- **The attachment path works against the real page.** Exactly one message came out as
  `[File: …]` — the attachment-only row that carries no `user-message` node, the case that made
  this conversation unexportable before PR #35. Until now it had only ever been exercised against
  a fixture.
- Rows rendered *after* the export (17, indices 39…55) re-confirm the recycling model from the
  other side: the walk finishes at the bottom and the top of the conversation is no longer in the
  DOM, so nothing about the result came from a lucky one-shot read.
- `scrollTop` came back to its exact pre-export value (8486). **That is weaker evidence than it
  looks**, and is deliberately not recorded as "the reader's place was preserved": the list grew
  9381 → 10545 px during the walk and *where* those 1164 px landed was never measured. A plain
  restore is still the right design, because Claude's list recycles rather than prepending older
  rows the way Gemini's does — but that is an inference from the recycling finding above, not
  something this session measured. What was measured is "the raw value was restored", not the
  stronger conclusion the Gemini bullet below earns by arithmetic.

Rendered toolbar, same session and same conversation:

| Measurement | Result |
|---|---|
| Container | inside `[data-testid="wiggle-controls-actions"]`, preceding `wiggle-controls-actions-share` |
| `data-prompt-vault-placement` | `native` (not the overlay fallback) |
| Buttons / distinct `aria-label`s | 4 / 4 |
| `toolbarButtonClass` tokens ours, and how many are absent from Claude's Share button | 28, of which **0** are absent |
| Computed color, ours vs Share — light | `rgb(11,11,11)` vs `rgb(11,11,11)` |
| Computed color, ours vs Share — dark | `rgb(255,255,255)` vs `rgb(255,255,255)` |
| Container rect | 78×28, `visibility: visible` |

The colors are *equal* to Claude's own control in both themes, which is the property that matters:
the buttons are not styled to match a theme, they inherit from it. Dark was reached with
`page.emulateMedia({ colorScheme: 'dark' })`, which flipped `html[data-mode]` `light` → `dark` and
the body background `rgb(249,249,247)` → `rgb(32,32,31)`.

Scope limit: **one** conversation. This establishes that the shipped walk completes on a real
56-row recycling list, not that it does at every length.

### 2026-07-29 — attachments render in TWO shapes, and only one of them is matched

Measured on a purpose-built 10-row conversation (four mixed turns plus one attachment-only turn),
each attachment created in the session rather than found, so the shapes are attributable to a known
file rather than inferred. Both shapes sit **outside** `[data-testid="user-message"]`.

| Shape | Markup | Seen for | Matched by shipped `attachmentImage` |
|-------|--------|----------|--------------------------------------|
| A — preview tile | `div[data-testid="<filename>"] > button > img[alt="<filename>"]` | a PDF; a 600×400 PNG | **yes** |
| B — file card | `div[data-testid="file-thumbnail"] > button > div > h3` (h3 text = filename) | a `.txt`; a 4×4 PNG; a pasted image | **no** — the row holds no `<img>` at all |

Shape B also carries the name on the button's `aria-label`, but as `"pv-probe-note.txt, txt, 4줄"` —
localized and with extra metadata, so the `h3` is the only clean name source. A pasted image (a
synthetic `ClipboardEvent` that Claude's handler accepted — it called `preventDefault`) produced
shape B under a Claude-generated name, `1785297473105_pasted-probe.png`.

**`[unknown]` — what selects shape A over shape B was not established.** Read the "Seen for" column
as a record of what each *specific file* produced, not as a rule: a PNG appears in **both** rows
(600×400 → A, 4×4 → B), which rules out file type as the determinant. Whether it turns on
dimensions, on a thumbnail being generated successfully, on paste-vs-attach, or on something else
was not measured (AGENTS.md #5). A fix must therefore handle **either** shape appearing for the same
kind of file rather than dispatching on extension.

**Two consequences, both live today.**

- **An attachment-ONLY turn whose file takes shape B blocks the whole export.** The shipped
  row-claim logic, replayed verbatim on the probe conversation: `declaredSetsize` 10,
  `renderedRows` 10, **claimed 9**. Row 8 — the `.txt`-only turn — is claimed by neither the turn
  query (no `user-message` node) nor `attachmentMarkers` (`shippedTileMatches` 0), so it reaches
  `buildMessages` as a gap. `viaAttachmentMarkers` was `[]` for the entire conversation. This is
  the pre-PR #35 failure mode, still reachable for every shape-B attachment.
- **In a mixed turn the attachment is unreported either way**, because `attachmentMarkers` runs
  only on rows the turn query did *not* claim. Silent omission, not a failure.

**The `[VERIFY]` item's blocking worry is disproved.** It was held back because scanning a *claimed*
row might sweep up a pasted image inside `user-message` and mislabel it `[File: …]`. Measured:
`imgsInsideUserMessage` was **0 in every row** of the conversation — attached or pasted, txt/pdf/png.
Attachments never render inside the turn body, so a row-level scan cannot reach turn-body content.
`readUserContent`'s `if (el.querySelector('img')) return '[Image]'` fallback never fired.

Position of a shape-B tile relative to the text body (row 0): neither contains the other, common
ancestor 4 levels below the row (tile at depth 8, `user-message` at depth 9), tile **first** in
document order.

### 2026-08-01 — attachment selectors stay quiet on plain user rows

Measured on one settled conversation with a full scroll-up walk. The script collected 28 user rows;
27 had neither measured attachment shape (`div[data-testid] > button > img[alt]` whose `data-testid`
matched the image `alt`, nor `[data-testid="file-thumbnail"] h3`). On those 27 rows:

| Selector | Matches |
|---|---:|
| `button > img[alt]` | **0** |
| `[data-testid="file-thumbnail"] h3` | **0** |

`rowsWithMatches` was empty, `reachedTop` was `true`, and the original `scrollTop` was restored to
`0`. The broad image selector therefore produced no fabricated attachment marker on the measured
plain rows, so no selector narrowing was justified.

Scope limit: one account and one settled conversation; 27 no-attachment user rows measured.

### 2026-07-29 — `data-is-streaming` is a real stream-completion signal

On a **settled** conversation — one reloaded, or one whose last turn has finished — there is exactly
**one** `[data-is-streaming]` node per assistant row (4 nodes / 4 assistant rows); user rows carry
none. It is a `div` wrapping `.standard-markdown`, and the value survives a full page reload as
`"false"` on every completed turn.

**That invariant does not hold during generation, and absence must never be read as "finished".**
The table below measures an assistant row existing for ~1.2 s *before* its stream node is mounted
(rows go 6→8 at t=21455 while the node count stays at 3 until t=22631). So on a live conversation
absence means "not an assistant row **or not yet mounted**" — a walk that treats a missing node as a
completed turn would terminate on a turn that has not started rendering, which is the truncation
PR #36 exists to prevent. `backlog.md`'s termination-condition item states the same rule.

Transition measured with an in-page 200 ms recorder — **420 samples over 84.0 s**, the full array
kept until write-up:

| t (ms) | what changed |
|--------|--------------|
| 203 | baseline: 6 rows, 3 stream nodes, none `true` |
| 21455 | rows 6→8, `aria-setsize` 6→8, new row text 26 chars — **the row exists before its stream node does** |
| 22631 | stream nodes 3→4, `true` count 0→1 — generating |
| 39439 | `true` count 1→0, retry buttons 3→4, text settles at 3727 chars |

Generating window ≈ 16.6 s (`firstStreamTrue` 22631, `lastStreamTrue` 39201). **Unlike Gemini's
`aria-busy`**, which stayed `true` ~2.4 s *after* its text stopped growing, Claude's flag flips
`false` in the same 200 ms sample as the final text chunk (`lastTextGrowth` 39439) — a definitive
end marker with no trailing margin, so it must not be read as a quiet-period guarantee. No stop
button was observable by `aria-label` in any of the 420 samples.

This is the signal the backlog item wanted for a real termination condition; what remains unmeasured
is how it reads on a row the virtualizer has recycled away, which is the case that item cares about.

### 2026-07-29 — artifacts, tool calls and extended thinking

Probe conversation: an artifact request, a web search, and two prose answers. Re-measured after a
full page reload — 8 rows, `aria-setsize` 8, **`unclaimedRows` empty**. None of the three features
yields a row the adapter cannot claim, which settles the structural half the second 2026-07-25 walk
left open.

What sits **outside** `.standard-markdown` on an assistant row, and is therefore not exported
(`outsideMdChars` 262 / 179 / 303 / 250):

- an `h2` screen-reader heading, `"Claude 응답: <first chars of the answer>"` — a duplicate of the
  prose, correctly excluded;
- the collapsed thinking / tool-summary chip;
- **the artifact card** — `"Pv probe artifact"` / `"코드"` / `"·"` / `"HTML"` / `"다운로드"`. An
  artifact is silently omitted from the export; the row still exports its prose;
- the action-bar labels.

Web-search **citation links are inside** `.standard-markdown` (`npmjs.com`, `github.com`), so
sources survive the export.

**Expanded extended thinking leaks into the message.** Clicking the thinking chip on the web-search
row took `.standard-markdown` from 1 to 2 (not nested) and the turn query from 1 match to 2:
`md[0]` is the thinking text (55 chars), `md[1]` the answer (1213). `buildMessages` joins every turn
node in a row, so with a thinking block expanded the thinking text is prepended to the assistant
message. This establishes one mechanism that produces a **multi-block** row; it does not explain the
2026-07-25 "one row with four turn nodes" observation, which was not reproduced here (measured
1 → 2 blocks, not four). See the note added to that entry above.

Discriminator, measured rather than guessed: the thinking block has an ancestor carrying
**`data-timeline-text`** (class `group/timeline-text`) three levels above the `.standard-markdown`.
The answer block has no such ancestor.

Scope limit: two purpose-built conversations on one account. Every attachment and feature was
created in-session, so these are the shapes *this* account produces today — not proof that no other
shape exists.

### 2026-08-09 — artifact card markup measured

Re-measured the purpose-built artifact conversation on the live logged-in page with Playwright,
returning structure only. The page contained **8 indexed rows** and exactly **1 artifact card**;
the card was outside `.standard-markdown` in row `data-index="1"`, which also contained one
`.standard-markdown` node.

- The card root is a `div` carrying the class token `group/artifact-block`; its content wrapper is
  `artifact-block-cell`.
- The content wrapper contains one title node with `leading-tight text-sm line-clamp-1` and one
  kind node with `text-xs line-clamp-1`; both are separate descendants of the same content column.
- The card had no `h3` and no `data-testid`/`data-test-id` descendant. It used a full-card view
  button plus a separate action button, so neither button label is the title/kind source.

This establishes the missing selector evidence for the artifact marker. Scope limit: one account,
one settled conversation, and one rendered artifact shape; the class tokens and child relationship
must be rechecked if implementation starts after another Claude UI change.

### 2026-08-09 — Claude navigation surfaces and long-response streaming

Measured the logged-in Claude navigation surfaces with structural-only Playwright probes. No
conversation, project, artifact, or memory text was returned by the probes.

- The sidebar is `aside[aria-label="사이드바"]`. Baseline measurement found **19** `/chat/:id`
  links; after adding 3 synthetic standalone chats, the recent-chat scroll port contained **20**
  links with `overflow-y=auto`, `clientHeight=564`, and `scrollHeight=760`. Scrolling it to the
  bottom (`scrollTop=196`) and waiting 2.5 s left the count unchanged. Its `View all` control opens
  `/chats`.
- `/chats` initially rendered 19 rows. After the 3 standalone probes and 3 synthetic project
  chats, it rendered a table with **25** rows, **25** chat links, and **25** time nodes. Its main
  scroll port has `overflow-y=auto`, `clientHeight=905`, and `scrollHeight=1320`; after scrolling
  to the bottom (`scrollTop=415`) and waiting 2.5 s, row/link/time counts stayed unchanged. No
  load-more control or additional page was observed at 25 rows. This still does not prove that a
  larger account cannot page from the server.
- The Projects index exposed **2** `/cowork/project/:id` project routes. Before synthetic growth,
  both measured `/cowork/project/:id` homes and corresponding `/project/:id` surfaces had one
  `main table > tbody > tr`. After adding 3 synthetic chats to one project, that project's two
  route surfaces had **4** table rows, **4** chat links, and **4** per-row menu buttons; every row
  still has one cell and one chat link. The chat anchor is an absolute overlay inside the row's
  single `td`; the row carries the `group/cdsrow` class token. Workspace-home heading counts remain
  `h1=1`, `h2=1`, `h3=4`.
- The expanded project still exposed no `ul`/`ol`/`role=list` markup or main-content scroll port.
  Its document scroll root remained `scrollHeight=953`, `clientHeight=953`, `scrollTop=0`; scrolling
  to the bottom and waiting 2.5 s left all 4 rows and links unchanged. No pagination attribute or
  load-more control was observed. This strengthens the current project-member list contract while
  retaining the larger-project/account scope limit.
- `/artifacts` is a separate management surface: the measured page exposed **2** artifact list
  items and tab controls. It was not treated as another assistant-row artifact-card shape.

For the stream/recycling check, a synthetic prompt requested 160 numbered plain-text sections in
the purpose-built artifact conversation. A 35.1 s in-page recorder sampled every ~180 ms (**190
samples**) while alternating the actual `[data-autoscroll-container]` between top and bottom. The
conversation declared **14** rows; the scroll port measured `clientHeight=905`, `scrollTop` ranged
from `0` to `33004.5`, and `scrollHeight` reached `33922`.

- `[data-is-streaming="true"]` was observed in **106/190** samples, always as a nested node under
  row `data-index="13"`; the row itself did not carry the attribute.
- Older indexed rows were recycled while scrolling: the rendered index set varied and omitted
  indices `6`, `7`, `8`, and `10` in the observed windows. The active streaming row `13` stayed
  rendered at both scroll extremes; **0** samples showed a true streaming node whose indexed row
  was absent.
- The response reached the settled state during the recording (`data-is-streaming="false"` on the
  final sample). This confirms the live signal and ordinary row recycling, but the specific
  “active streaming row already recycled” case remains unmeasured; do not infer that it cannot
  occur outside this account/state/scroll pattern.

A follow-up used the same purpose-built conversation after adding **8** synthetic short exchanges,
bringing `aria-setsize` to **30** before the long response and **32** after its new user/assistant
pair. The new prompt requested 220 numbered sections. A 45 s recorder sampled every ~120 ms
(**368 samples**) while alternating the real scroll port between top and bottom:

- `[data-is-streaming="true"]` was present in **368/368** samples, always under row
  `data-index="31"`; top and bottom each contributed **184** samples.
- The rendered index union was `[0,1,2,3,4,5,13,24,25,26,27,28,29,30,31]`, demonstrating further
  recycling while the response grew. The active row `31` was present in every true sample; the
  count of true-marker samples whose indexed row was absent was **0**.
- A later structural poll observed the marker flip to `false` after approximately **37.0 s**.
  After settling, row `31` still appeared at both scroll extremes. This is a stronger negative
  measurement, not a direct observation of the already-recycled-active-row state, so the
  termination-condition blocker remains until that state is observed or the implementation
  contract is deliberately changed.

A final flow probe tested an older generated turn rather than appending a new one. With the
synthetic conversation at **34** rows, the measured assistant row `data-index="1"` had a real
`button[aria-label="재시도"]`. Clicking it regenerated that turn but immediately reduced
`aria-setsize` to **2** and removed the tail; only rows `0` and `1` remained, with
`data-is-streaming="true"` on row `1`. The response later settled with the same two rows and
`data-is-streaming="false"` on row `1`.

Together, the two live flows establish the current UI invariant: appending a response creates the
newest row and keeps it rendered while streaming, while retrying an older row removes all later
rows before streaming. No measured live flow leaves an active streaming row in the middle of a
still-present virtualized tail. This does not prove a future Claude branch cannot change the
behavior; remeasure after such a UI change.

### 2026-08-10 — the sidebar is unique and has no nav landmark, and the Recents list does not page

Settled the `[FIX]` that asked for "a stable Claude sidebar handle (nav landmark or data attribute)"
and, in the same walk, the PR #61 `[FIX]` that asked whether a long sidebar recycles. **Both close
without a selector change** — the first because the shipped narrowing turned out to be measurably
correct, the second because its premise does not exist.

**Method and environment**, recorded here rather than left as context (the 2026-07-29 lesson).
Playwright MCP, server invoked as `npx @playwright/mcp@latest` with no `--user-data-dir` and no
`--extension`; the profile was **already logged in** to claude.ai and gemini.google.com and no login
step was performed at any point, which is the behaviour the 2026-07-29 correction above predicts.
Probes were self-contained snippets that copied selector strings rather than importing them, and
returned counts, attribute *names*, and booleans — never conversation text. The account held **25
Claude conversations**, UI language `ko-KR`. `.playwright-mcp/` was removed at the end of the
session rather than left holding accessibility trees of the account's conversations.

**The sidebar is unique, measured on two routes** (`/new` and a `/chat/<id>` page):

| Measurement | `/new` | `/chat/<id>` |
|---|---|---|
| `aside` elements in the document | 1 | 1 |
| asides containing `a[href^="/chat/"]` | 1 | 1 |
| chat links inside that aside | 20 | 20 |
| chat links **outside** any aside | 0 | 0 |
| `nav` / `[role="navigation"]` landmarks | **0** | **0** |
| `[data-row-key^="chat:"]` rows | 20 | 20 |

This is the fact PR #58 could only derive. It dropped the Korean `aria-label` and narrowed a page's
asides by chat-link containment, and the open item objected — correctly — that containment was
inferred from the measurement rather than measured as unique. It now is: one aside, it is the one
with the links, and nothing outside it competes.

**The two alternatives the item proposed were measured and both rejected.** There is **no nav
landmark at all** — zero `nav`, zero `[role="navigation"]` — so the landmark half of the request has
no target. The aside *does* carry locale-independent attributes, `data-variant="web"` and
`data-density="comfortable"`, and they are the reason to state carefully why they are not used:
both are **configuration** values (the platform, and the user's density preference), so pinning
either value would break under a different setting, and matching on presence alone is no more
discriminating than the containment test already shipped. **No English-locale fixture was captured,
and none is needed** — the shipped selector never reads the label, so there is nothing for a
second-locale fixture to falsify.

One handle worth recording even though nothing reads it: sidebar rows carry
`data-row-key="chat:<uuid>"`, 20 of 20 on both routes — per-conversation identity with no `href`
parse and no locale.

**The Recents list does not page, and does not recycle.** Twelve rounds at 1200 ms, scrolling the
sidebar's own scroll port to its bottom each round:

| Round | rendered | cumulative | scrollTop | scrollHeight |
|---|---|---|---|---|
| 0 | 20 | 20 | 0 | 760 |
| 1 | 20 | 20 | 242 | 760 |
| 2–12 | 20 | 20 | 242 | 760 |

`scrollHeight` never moved off 760 px and the port clamped at 242 after the first step; rendered and
cumulative stayed equal at 20, so nothing was trimmed either. The sidebar instead exposes a
**"모두 보기 / View all"** control, and the full list lives at **`/recents`** — a
`table[data-cds="Table"]` (see the entry below) which rendered all 25 of the account's conversations
and grew by nothing across 20 further scroll rounds.

**What this does to the PR #61 item: its premise is void.** That item asked to stop the walk early
*if* a long sidebar recycles, because a target revealed mid-walk could be dropped again. But the
list is **statically capped at 20 by the UI** — `loadMoreConversations` cannot surface a row that is
not already rendered, so there is no mid-walk reveal to lose and no early exit that would help.

**A different and larger hazard replaces it, and it is new.** The bulk track walks the sidebar, so
it can reach **at most those 20 rows regardless of account size** — on this 25-conversation account
that is already 5 short, silently. Filed in `backlog.md`; it needs a route decision (move the track
to `/recents`), not a selector.

Scope limits: one account, 25 conversations, `ko-KR`, one window size. That the cap is exactly 20
is measured at this scale only, and whether `/recents` itself pages at a larger scale is **not**
established — 25 rows fit without paging, so no page boundary was ever crossed.

### 2026-08-10 — the project table is attribute-addressable but pinning it is a net loss; the artifact card has no attribute at all

Settled the `[FIX]` asking to "anchor `projectTable` / `artifactTitle` / `artifactKind` on measured
attributes". **Both halves come back negative, for different reasons** — the project table *has* a
measured attribute that it is not worth pinning to, and the artifact card has none at all. Same
session, method and account as the entry above.

The project route reached from `/projects` on this account is `/cowork/project/<uuid>`, which
`PROJECT_PATHS` in `src/adapters/claude/matches.ts` already covers, so no route change was needed.
Be precise about the scope: `PROJECT_PATHS` matches **two** families, `/cowork/project/<id>` and
`/project/<id>`, and only the first was exercised on 2026-08-10. Nothing below is evidence about
`/project/<id>` (`[unknown — not measured 2026-08-10]`).

**Hydration: absent → complete, with no partial state.** Sampled every 100 ms across an SPA
navigation from `/projects` into a project home (only the rounds where the shape changed are shown;
31 samples were taken over 3 s):

| t (ms) | route | `main table` | `[data-cds="DataTable"]` | tbody rows | chat links |
|---|---|---|---|---|---|
| −1 | `/projects` | 0 | 0 | 0 | 0 |
| 100–700 | `/cowork/project/<id>` | 0 | 0 | 0 | 0 |
| 800–3000 | `/cowork/project/<id>` | 1 | 1 | 1 | 1 |

This answers what the item asked — "what a project home renders before its table hydrates" — with
**nothing**. There is no window in which a table exists carrying zero rows, which is the same shape
as the message-list hydration measured 2026-07-25 (~600 ms of no `role="article"` at all, then the
full count). So a consumer that waits for `resolveProjectTable` to return non-null cannot latch onto
a half-built list; it either sees no table or sees the finished one.

**The table is attribute-addressable, and the attribute is what separates it from a markdown table:**

| Page | table | `data-cds` on it | inside `[data-cds="DataTable"]` | chat links |
|---|---|---|---|---|
| project home A | `main table` | `Table` | yes (ancestor depth 2) | 1 |
| project home B | `main table` | `Table` | yes | 4 |
| `/recents` | `main table` | `Table` | yes | 25 |
| `/chat/<id>`, assistant markdown table | `main table` | **none** | no | 0 |

The markdown table was observed **6 times across a scroll walk** of one conversation (it is
virtualized out at load and had to be scrolled into view), every time inside `.standard-markdown`,
every time without the attribute, and always with zero conversation links.

**The obvious use of this — pinning `selectors.projectTable` to
`main table[data-cds="Table"]` — was tried on this evidence and REVERTED.** Recorded here because
the reasoning is the useful part, and because the first draft of this entry got it wrong in a way
three reviewers caught.

The draft claimed the markdown-table ambiguity "was real rather than theoretical": that
`resolveProjectTable`'s anchor-less fallback to the *first* table would, on a `/chat/<id>` page,
hand the markdown table to every consumer including `projectToolbarMount`. **That failure is not
reachable.** Every project consumer is route-gated before it runs — `projectToolbarMount` only via
`syncButtons` → `isProjectPage` → `matchesProject` (`src/content/mount.ts`), `openProjectBulkExport`
via `pickProjectAdapter(location.href)`, and `openProjectConversation` returns to the project home
first. On a conversation page none of them execute, so nothing was being handed anything. The
attribute would have been defence-in-depth against a route gate that already holds, not a fix
(AGENTS.md #5).

Against that near-zero reachable gain, pinning costs a **silent** failure. `resolveProjectTable`
returning null makes `listProjectConversations` yield `[]`, and the bulk panel renders `[]` as its
"no conversations" empty state — indistinguishable from a genuinely empty project. So a rename of
that one unversioned design-system attribute would tell a user with a full project that it holds
nothing, with no error, where the plain tag selector would have kept working. It would also rest on
an unmeasured assumption for the `/project/<id>` route family noted above.

**What the session changed instead is the missing-table case**, which is the real AGENTS.md #4 hole
and is independent of which selector is used: `listProjectConversations` now throws when it is on a
project route and resolves no table, rather than reporting an empty project. That guard is also the
precondition for pinning the attribute later — with it in place, attribute drift would be loud.

**The artifact card carries no attribute to anchor on. That is the result, not a gap in the
session.** Four kinds were surveyed — one pre-existing HTML artifact plus a Python, a Markdown and a
React artifact created in the account for this measurement, so each shape is attributable to a known
artifact:

| Kind | `artifactTitle` matches | `artifactKind` matches | text-column children | `data-*` on the card |
|---|---|---|---|---|
| HTML | 1 | 1 | 2 | none |
| PY | 1 | 1 | 2 | none |
| MD (`문서 · MD`) | 1 | 1 | 2 | none |
| JSX (`코드 · JSX`) | 1 | 1 | 2 | none |

The only `data-*` attribute anywhere inside a card is a single `data-cds="Button"` on the download
control. There is none on the card, the title, or the kind — so the fix the item requested cannot be
built, and the selectors stay class-token based.

**The hazard the item was filed against also did not appear.** It predicted that "a second
`text-xs line-clamp-1` node inside a card (a timestamp, a version badge) fails the whole conversation
export". Across all four kinds that token pair matched **exactly once**. The prediction about the
consequence was right — `artifactMarkers` requires exactly one non-empty match and throws otherwise
— but the condition was not observed, and the failure it produces is loud rather than a mislabelled
artifact (AGENTS.md #4).

What *is* structurally stable, recorded in case the utility classes churn: the text column inside
`artifactCell` held **exactly two children in all four cards**, title first and kind second. A
positional rewrite was considered and rejected — it trades utility-class fragility for a child-index
chain that is no less fragile, with no measured advantage.

Two incidental findings from the same dump, both filed rather than acted on. The card's download
button carries `aria-label="<title> 다운로드"` — localized and title-bearing, so not a clean title
source. And the **kind string is itself localized** (`문서 · MD`, `코드 · JSX`), while it reaches
Markdown and JSON verbatim inside `[Artifact: <title> (<kind>)]`, so the same artifact exports
differently per UI language.

Scope limits: one account, `ko-KR`, two projects (1 and 4 members), four artifact kinds. The
two-children structure and the single-match counts are established across those four kinds, not
across every kind Claude can render.

### 2026-08-11 — `/recents` holds the whole list and is walkable, but nothing links to it; an empty project renders no table at all

Settled the two `[FIX]`es that the 2026-08-10 session could only file: where the conversations
above the sidebar's 20-row cap actually live, and what an empty project home renders. Both answers
changed the shape of the fix, so read the two "consequence" paragraphs, not just the numbers.

**Method and environment.** Playwright MCP, `npx @playwright/mcp@latest`, no `--user-data-dir` and
no `--extension`; the profile was already logged in and no login step was performed. Probes were
self-contained snippets copying selector strings rather than importing them, and returned counts,
attribute names and booleans — no conversation text was returned by any probe. The account held
**26** conversations (25 on 2026-08-10) and **two** pre-existing projects; a third, empty project
was **created in the account for this measurement** (`pv-empty-project-probe`,
`/cowork/project/019fee6c-e6ad-77e1-9e39-9b718ee6e400`), since neither existing project was empty.

**`/recents` is the complete list, and it does not page.**

| Surface | conversation tables | rows | anchors per row | chat links |
|---|---|---|---|---|
| `/recents` `main table` | 1 (`data-cds="Table"`, inside `[data-cds="DataTable"]`) | 26 | 1 on 26/26 | 26 |
| the same page's `aside` | — | — | — | 20 |

So the sidebar cap is confirmed from the other side: 46 `a[href^="/chat/"]` exist on `/recents`,
26 in the table and 20 in the aside. A 12-round scroll walk of the table's port
(`.dframe-pane-scroller`, `overflow-y: auto`, 1500 ms dwell) held **26/26 rendered on every round**,
`scrollHeight` constant at 1369 and `scrollTop` clamping at 510 after the first step, with the
first row still rendered at the end — so the list is **fully rendered, not virtualized, and not
recycling**. `/recents` also tracked the account's growth (25 links on 2026-08-10 → 26 today),
which is the evidence that it is not itself capped at a fixed number.

*Scope limit:* "does not page" is established **at 26 conversations**. Whether `/recents` pages on a
much larger account is `[unknown — not measured]`, exactly as the sidebar's own shape was before
2026-08-10. Any walker built on this must keep a completeness signal rather than assume one round.

**The batch loop works: click a row, then `history.back()`.** From `/recents`, clicking a row's
anchor reached `/chat/<id>` with rendered rows in **1005 ms**; `history.back()` restored `/recents`
in **151 ms** with all **26** rows already present, and still 26 after a further 1500 ms settle. So
the project track's return-to-home shape (`returnToProjectHome` in `src/adapters/claude/index.ts`)
transfers to this surface unchanged. `/recents` carries **no** `wiggle-controls-actions` header bar;
its `main` exposes `[data-testid="page-header"]`, and the conversation table's parent is a plain
`div` whose only child is the table — the same mount shape `projectToolbarMount` already uses.

**Consequence, and the reason the planned fix changed: nothing in the DOM links to `/recents`.**
No `a[href="/recents"]` exists anywhere in the document. The sidebar's two entry points are
`<button>`s — `aria-label="View all"` at the section header and `모두 보기` at the list foot — and
neither carries a locale-independent handle (`data-cds="Button" data-size="xs"` is shared by dozens
of unrelated controls, and the labels are UI text). There is therefore **no way to move an
already-open bulk panel from `/chat/<id>` to `/recents`**: clicking is impossible without a
fabricated selector (AGENTS.md #5), and assigning `location` reloads the page, which destroys the
panel — the very reason `openConversation` clicks anchors instead. So the history bulk track is
offered **on `/recents` itself**, as the project track is offered on a project home, rather than
navigating there on the user's behalf.

**An empty project renders zero `main table`.** Measured on the project created above, against the
two populated ones:

| Project | `main table` | chat links in `main` | `[data-testid="project-doc-upload"]` |
|---|---|---|---|
| empty (`pv-empty-project-probe`) | **0** | 0 | 1 |
| 1 member | 1 | 1 | 1 |
| 4 members | 1 | 4 | 1 |
| (`/chat/<id>`, for contrast) | 0 | 0 | **0** |

**Consequence: the `backlog.md` diagnosis was wrong, and so was the fix it implied.** It held that
an empty project resolves `tables[0]` to "a knowledge/file table" and then throws on its rows. There
is no such table — a populated project home renders exactly **one** `main table`, the conversation
list, and an empty one renders none. What an empty project actually hits is the *other* branch: the
markup-drift error PR #62 added for "a project route that renders no table at all". That error
fires on every empty project. The discriminator is `[data-testid="project-doc-upload"]`, present on
both project homes measured (empty and populated) and absent on `/chat/<id>`: the project-home shell
having rendered, with no conversation table, **is** the empty project; the shell not having rendered
is still drift. Narrowing `resolveProjectTable` (which was tried first, on the backlog's premise) is
**not** the fix and was reverted — it would have traded the drift guard away for nothing.

**The shell is not a table-render signal — the two hydrate ~400 ms apart.** This was measured
*after* the first version of the fix shipped `shell present ⇒ empty project`, because review asked
what the shell actually proves. A 50 ms sampler installed on `/projects`, then an SPA click through
to the 4-member project:

| t (ms) | route | `project-doc-upload` | `main table` | chat links in `main` |
|---|---|---|---|---|
| 7 | `/projects` | 0 | 0 | 0 |
| 104 | project home | 1 | 0 | 0 |
| 520 | project home | 1 | 1 | 4 |

So a populated project spends **~350 ms** in a state indistinguishable from an empty one, and the
table and its links arrive together (never links without a table, never a table before the shell).
Consequence, recorded in `listProjectConversations`: the shell alone is not sufficient to call a
project empty. The adapter additionally requires **no `a[href^="/chat/"]` inside `main`** — a
project that has conversations still renders links to them however the wrapper changes, so list
drift stays loud instead of collapsing to "no conversations". The `main` scoping is load-bearing,
not incidental: the app shell's `aside` carries up to 20 recent-chat anchors matching that same
selector on every route measured here, so a document-wide probe would fail every empty project for
every account with any history. All project-home counts above are `main`-scoped for the same
reason. The remaining hole is a hydration slower than the
content layer's 3 s overlay-fallback grace, which is ~6× the measured 520 ms; no DOM signal
separates that from an empty project, so it is accepted and written down rather than assumed away.

Scope limits: one account, `ko-KR`, 26 conversations, three projects (0, 1 and 4 members), one
`/recents` walk, one hydration trace (SPA navigation; a cold full page load is
`[unknown — not measured]`). `/project/<id>` remains `[unknown — not measured]`.

## Gemini

### 2026-07-25 — the exchange list pages in older turns on scroll-up, 10 at a time

Measured through Playwright MCP against the live logged-in page, on a conversation grown to 17
exchanges for the purpose. This is the finding the whole adapter is shaped around:

- **A fresh load renders only the newest 10 exchanges.** Measured three times, on conversations of
  11, 16 and 17 exchanges — every one rendered **10** (`scrollHeight` 6231, 5019 and 5019 against a
  `clientHeight` of 836). The page size did not vary with conversation length.
- **The rest arrive in batches as the walk nears the top of the loaded range.** On the 16-exchange
  conversation the rendered count went **10 → 16 in a single round** with `scrollHeight` 5019 →
  9129 (settling at 9614 as content laid out); on the 11-exchange one, 10 → 11 with 6231 → 7333.
- **Nothing is ever trimmed.** A 35-round up-then-down walk on an 11-exchange conversation held
  11/11 rendered on every round (`windowed: false`), and after a fresh load grew to the full count
  it never fell. So the list is **append-only**, like ChatGPT's `#history` — *not* a recycling
  virtualizer like Claude's message list, despite the element being named `infinite-scroller`. Do
  not generalize any provider's virtualization model to another.

Consequence: a one-shot `querySelectorAll` sees only the newest page. On the 17-exchange
conversation that is **10 of 17 exchanges — 41% silently missing** (AGENTS.md #4), which is why
`extract` walks the scroll port to the top before reading.

Because nothing is trimmed, the adapter does **one ordered read after** the walk rather than
accumulating across rounds. That is not merely simpler, it is the only option that preserves
order: Gemini's sole per-exchange identity is the container's opaque hex `id`, which cannot be
sorted. Document order is the conversation order.

### 2026-07-25 — Gemini offers no completeness oracle

Same session. `aria-setsize` resolved to **0 elements document-wide**, there is no `aria-posinset`,
and no numeric index attribute anywhere on the exchange containers — so none of the checks the
Claude adapter relies on (contiguity, starts-at-zero, declared total) are available here, and the
ids being opaque means a collected set cannot be compared against anything.

**The walk's settle dwell is therefore the only bound on completeness.** The adapter requires
`scrollTop === 0` **and** an unchanged `scrollHeight` **and** an unchanged rendered count, held for
6 consecutive rounds at 500 ms (~3 s of quiet). Position alone is not usable as a stop condition —
arriving at the top is precisely what *triggers* the next batch. The residual hazard is the same
shape as the ChatGPT `#history` dwell item in the review backlog: **a batch slower than ~3 s would
still truncate silently.** The dwell was sized against the only comparable latency this repo has
measured (ChatGPT's `#history` pages at 1418–2830 ms); the one Gemini batch that was timed landed
inside a single 350 ms round, so this errs slow deliberately. It is a heuristic, not a proof.

**That justification no longer holds, as of the 2026-07-28 re-measurement above.** The comparable
ChatGPT band is now **1509–7516 ms**, so a ~3 s dwell does not err slow against it — it sits roughly
2.5× under the observed worst case. Nothing about Gemini itself was re-measured, and Gemini's own
batch may well stay fast; what changed is that the *analogy* the dwell was sized by no longer supports
it. Re-measure Gemini's batch latency before treating the ~3 s dwell as conservative.

### 2026-07-25 — `aria-busy` on the response is a real stream-completion signal

Same session, sampling every 300 ms across a generating response. The streaming turn's `.markdown`
carried **`aria-busy="true"`**, flipping to `"false"` on completion — and it stayed `true` for
**~2.4 s after the response text stopped growing** (length frozen at 2697 characters while the
attribute was still `true`). So it is strictly stronger than a "has the content changed?"
heuristic, which would have declared that response finished 2.4 s early.

The input area simultaneously carried `button[aria-label="대답 생성 중지"]`, which disappeared on
completion — the same state, but behind a localized label, so the attribute is the machine-readable
form. The adapter fails loud on it rather than exporting a half-written answer; neither the ChatGPT
nor the Claude adapter has an equivalent signal to use.

### 2026-07-25 — Gemini's structural facts, as used by `src/adapters/gemini/selectors.ts`

Same session. Conversation URLs are `gemini.google.com/app/<16-hex-id>`; `/app` alone is the
new-chat route. Facts the adapter depends on:

- **An exchange, not a message, is the unit of structure.** `div.conversation-container` wraps a
  prompt *and* its reply; there is no per-message element. Measured on a 16-exchange conversation:
  all 16 containers held exactly one `user-query`, one `model-response` and one `.markdown` —
  **1:1:1, 16/16**. Containers are direct children of the scroll port.
- **The container `id` is the only per-exchange identity** (an opaque 16-hex value, e.g.
  `a1b2c3d4e5f60001`), and it is shared by both turns in the exchange. There is no per-message id.
- **A naive read of the user's prompt captures a screen-reader label.** `.query-text` holds
  `span.cdk-visually-hidden.screen-reader-user-query-label` *before* the prompt text, so
  `textContent` returned `"말씀하신 내용 Line one of my question."`. The label text is localized and
  therefore not matchable; the adapter reads `p.query-text-line` elements instead and strips the
  span on the fallback path.
- **A multi-line prompt is one `p.query-text-line` per line, and a blank line is an EMPTY one
  holding a single `<br>`.** Measured on two prompts the user had typed by hand: **136 line
  elements of which 42 were exactly empty**, with `querySelectorAll('br').length` also **42**; and
  **16 of which 4 were empty**, all four containing a `<br>`. Neither prompt had a whitespace-only
  line. Those empties are the paragraph breaks, so extraction must keep the interior ones — the
  first revision of the adapter dropped them with `.filter(Boolean)` and flattened all 42
  paragraph breaks of the 136-line prompt into one undifferentiated block (caught in review).
  Leading and trailing empties are trimmed, being padding rather than content.

  Worth recording for the next session: this was measured only after the *synthetic* route failed
  outright. Gemini's Quill composer rejected every attempt to inject a newline —
  `execCommand('insertLineBreak')` cleared the composer, a synthetic `paste` event was ignored as
  untrusted, and a `\n` inside `insertText` submitted the first line only. Reading the shape off
  conversations the user had already typed cost two page loads and settled it; do that first next
  time.
- **Response chrome sits outside the prose container**: `sources-list`, `thinking-overlay` and
  `message-actions` are siblings of the `.markdown`, not descendants (measured: none appear among
  its descendants), so serializing `.markdown` excludes them with no filtering.
- **Code fences declare their language in a header label that is a SIBLING of the `<pre>`** —
  `div.code-block-decoration` holding "Python" / "JSON" / "Markdown" — and tag **no `language-*`
  class** on the `<code>` (live: `class="code-container formatted …"`, with highlight.js `hljs-*`
  spans inside). This is a third convention, distinct from both Claude (class on the `<code>`) and
  ChatGPT (label *inside* the `<pre>`), and `codeLanguage()` in `src/core/html-to-markdown.ts` sees
  neither. The Gemini adapter therefore copies the label onto the `<code>` as a `language-…` class
  in a clone, and deletes the label and the copy-button row — left in place, being ordinary
  siblings, they would serialize as a paragraph of prose above the fence. One block in the same
  response rendered with **no decoration at all**, so an absent label is a normal case.
- **The code block's control row is `div.buttons`, a sibling of the `<pre>` holding two
  `gem-icon-button`s** (each wrapping a `button.mdc-icon-button > gem-icon > mat-icon`). Measured
  by dumping every descendant of all four `code-block`s in one response: the three labelled blocks
  had 31, 27 and 28 descendant elements including exactly two `gem-icon-button`s each, while the
  unlabelled block had **5** descendants total — `div.code-block > div.formatted-code-block-internal-container
  > div.animated-opacity > pre > code` and nothing else, no decoration and no control row. The
  adapter removes every matched `div.buttons` within a block regardless of count, so this number
  is a record of what was seen rather than something the code depends on.
- **`.markdown` is the prose container**, the same class name ChatGPT uses — the only selector that
  happens to coincide between providers. It carries `aria-live="polite"` and the `aria-busy` above.
- **Scroll port is attribute-addressable**: `infinite-scroller[data-test-id="chat-history-container"]`.
  Scoping by the test id is required, not cosmetic: the document contains a **second**
  `infinite-scroller` (the history sidebar) that also overflows.
- **`document.title` is `"<conversation title> - Google Gemini"`**, and while a conversation loads
  it is `"‎Google Gemini"` — prefixed with an invisible **U+200E** (charCode 8206). Stripped before
  the untitled-state comparison, which would otherwise silently fail to match.
- **Header bar**: `top-bar-actions > div.top-bar-actions > div.left-section | div.center-section |
  div.right-section`. The right section holds an empty upsell `div.buttons-container` followed by
  the real one, whose first control is `tts-control-v2` ("듣기"), then the conversation-actions
  menu. **Gemini has no Share button**, so unlike the other two providers there is no share control
  to sit beside; the export buttons are inserted before the `div.buttons-container` holding the TTS
  control.
- **Native button classes** (the source of `TOOLBAR_BUTTON_CLASS`), captured in full from the TTS
  button:

  ```
  mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-tooltip-trigger tts-button
  mat-unthemed ng-star-inserted
  ```

  The adapter uses a subset, dropping `tts-button` (the speech control's own identity),
  `mat-mdc-tooltip-trigger` (an Angular Material directive these buttons do not use) and
  `ng-star-inserted` (a framework marker). Angular's per-build scoping attributes
  (`_ngcontent-ng-c…`, `ng-tns-c…`) appear on nearly every node and MUST NOT be selected on — they
  are regenerated on each Gemini deploy. As with Claude, a class string is the one kind of captured
  value nothing type-checks, so `test/adapters/gemini/toolbar-mount.test.ts` pins every token
  against the fixture's full reproduction of the string above. Keep the fixture's copy FULL;
  abbreviating it turns that guard into a tautology.

### 2026-07-25 — re-probe of the shipped adapter

Same session, after implementation: a self-contained probe reproducing the shipped selector strings
and walk (copied, not imported) was run against the live 17-exchange conversation.

| Measurement | Result |
|---|---|
| One-shot read on a fresh load | **10** exchanges (of 17) |
| Walk reached the settled top | yes, in 27 rounds |
| `scrollHeight` during the walk | 5019 → 10065 |
| Final ordered read | **17** exchanges → **34 messages** (17 user + 17 assistant) |
| Unreadable turns | 0 |
| Screen-reader label leaked into a prompt | 0 |
| Shortfall guard would fire | no |
| Scroll position restored | yes |
| Toolbar mount / anchor resolved | yes; insertion point `div.buttons-container`, anchor inside the mount |
| `toolbarButtonClass` tokens absent from the native button | 0 of 4 |

Re-probed a second time after review changed the walk, on the same 17-exchange conversation. Same
completeness result (10 one-shot → 17 walked, 34 messages, 0 unreadable, 0 label leaks), and two
numbers that turned review arguments into measurements:

- **A batch stalls for up to 4 rounds** (`maxStallRoundsSeen: 4` — 2 s at the 500 ms step). The walk
  spent 27 rounds of which only **21 covered distance**. The first revision charged every round to a
  distance-derived cap with a fixed ~13 rounds of slack, 6 of which the settle dwell always consumes;
  at 4 stall rounds per batch, a conversation needing nine batches would exhaust that and report
  "timed out" on a page where nothing was wrong. Travel and stalling are now separate budgets
  (`travelSteps 21` against `travelCapAtEnd 35`), and only movement is charged.
- **Restoring the pre-walk `scrollTop` would have moved the reader 5046 px** (`beforeTop 4111`,
  restored `9157`) — because paging grew the list from 5019 to 10065 ABOVE them. The walk restores
  distance from the bottom instead, which is invariant under prepending.

**Still unverified, and deliberately not guessed at** (tracked in `backlog.md`):

- **What a landing batch does to `scrollTop`.** A browser preserving visual position shifts the
  viewport down by the prepended height; scroll anchoring turned off, or a virtualizer managing its
  own spacer, would leave `scrollTop` at 0. The live walks only ever observed batches landing while
  the walk was still climbing, so neither outcome was isolated. The walk is written to survive both
  — that is what the settle condition's "is the list still changing?" term is for, and the test
  fake models both shapes explicitly (`batchLandingShiftsViewport`).
- ~~**Responses that render no `.markdown` at all.**~~ **Resolved 2026-07-29 — see the entry above.**
  The premise was wrong: a generated image and a Canvas/immersive response BOTH render a
  `.markdown`. Canvas fills it and exports fine; a generated image leaves it EMPTY, which reaches
  `unreadableExchangeError` — the retry advice that can never clear — rather than the "please report
  this" message this bullet assumed. Whether any shape renders no container at all is still open.
- ~~**Prompts carrying files or images.**~~ **Resolved 2026-07-29 — see the entry above.** The tiles
  sit inside `user-query` but outside `.query-text`, as
  `user-query-file-carousel > user-query-file-preview`. The old `user-query img` count of 0 was an
  artifact of no measured conversation having had an attachment. A name is available for a non-image
  file only, by joining `filename-label` with a lowercased `extension-label`; an image exposes none,
  so `[Image]` remains the honest limit (AGENTS.md #5).
- **The Gems and project routes**, and the **sidebar bulk track**. The sidebar was observed only in
  passing (33 `[data-test-id="conversation"]` anchors inside its own `infinite-scroller`); its
  paging shape was never measured.
- Measurements come from **one account and one conversation shape** (prose and code, no attachments,
  no Gems). The page size of 10 was stable at 11/16/17 exchanges — 31 as of the session below — but
  is not established at, say, 200, and it is the one number whose drift can quietly weaken a guard
  rather than break it, so it is listed in "Re-measure these numbers" at the top of this doc. A
  **smaller** page size than 10 is the dangerous direction: it makes `readUnwalkable`'s threshold
  under-trigger and lets a partial export through unnoticed.

### 2026-07-25 (second session) — the shipped extension's own walk, and the rendered toolbar

The re-probe above copied the shipped selectors and walk; this is the **built extension** (1.7.0,
reloaded from a fresh `npm run build` before measuring) doing it itself. Two conversations: the
17-exchange one measured previously, and a **31-exchange** one created for this test.

| Measurement | 17-exchange | 31-exchange |
|---|---|---|
| Exchanges rendered at fresh load | (not cold — see below) | **10** |
| Exported JSON `messages` | 34 | **62** |
| Roles | 17 / 17 | 31 / 31 |
| Messages with empty content | 0 | 0 |
| Exchanges rendered after the export | 17 | **31** |
| `scrollHeight` before → after | — | 3049 → 8152 |
| Wall clock | not timed | 13.1 s |
| `aria-setsize` document-wide | 0 | 0 |
| Downloads produced | 4 real files — json 16,710 B · md 15,049 B (36 headings) · pdf 37,805 B (`%PDF-` header present) · html 16,810 B (`<html>` present) | json only, 5,563 B |

- **The page size held at 10 on a 31-exchange conversation.** That extends the measurement behind
  `INITIAL_PAGE_SIZE` from 11/16/17 exchanges to 31 — still the newest 10 regardless of length.
- **62 messages against 31 exchanges**, so the walk paged in the 21 exchanges the cold load
  withheld. A one-shot read would have exported **20 of 62 messages — 68% missing, silently.**
- **The bottom-distance restore is confirmed on a real paging list.** Distance from the bottom was
  **72 px before the export and 72 px after** (`scrollTop` 2187 → 7290 while `scrollHeight` grew
  3049 → 8152). Restoring the raw `scrollTop` instead would have dropped the reader 5103 px earlier
  in the conversation. That hazard was previously argued from one observation of a walk in
  progress; it is now measured end to end.
- **The 17-exchange run counts only as a download result.** Its list was already fully loaded when
  the export ran: Gemini kept the walked state across a same-URL `page.goto` within the session, so
  its `renderedAtStart` was 17, not 10, and that run says nothing about paging. **Open a new tab**
  when a genuinely cold load is needed — a re-`goto` is not enough.
- `/app` (the new-chat route) mounted no buttons, which is `isConversationPage()`'s exclusion of it
  working rather than a failure.

Rendered toolbar, same session:

| Measurement | Result |
|---|---|
| Container | direct child of `div.right-section`, preceding `tts-control-v2` |
| `data-prompt-vault-placement` | `native` (not the overlay fallback) |
| Buttons / distinct `aria-label`s / glyph `svg`s | 4 / 4 / 4 |
| Button class | `mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-unthemed` — the four `TOOLBAR_BUTTON_CLASS` tokens, nothing else |
| Computed color — light | `rgb(68,71,70)` on body background `rgb(253,252,252)` |
| Computed color — dark | `rgb(196,199,197)` on body background `rgb(15,15,15)` |
| Container rect | 160×40, `visibility: visible` |

Dark was reached with `page.emulateMedia({ colorScheme: 'dark' })`, which swapped
`body.light-theme` for `dark-theme`; the buttons' color inverted with it, so they follow Gemini's
theme tokens rather than carrying a fixed color. Unlike Claude there is **no equality check against
a neighbouring native control** available here: `tts-control-v2`'s button is a *filled* control
(background `rgb(157,210,255)` light, `rgb(31,59,155)` dark), so its computed color is not
comparable with a plain icon button's. The evidence is the inversion, not a match.

Scope limit: two conversations on one account, both prose/code or one-word answers, no attachments
and no Gems.

### 2026-07-29 — a generated image renders an EMPTY `.markdown`, not a missing one

Measured on a purpose-built conversation with three exchanges, replaying `readExchange`'s branches
verbatim per exchange:

| Exchange | `.markdown` | prose length | adapter verdict |
|----------|-------------|--------------|-----------------|
| prose reply | present | 2 | exports ok |
| **generated image** | **present** | **0** | **throws `unreadableExchangeError`** |
| Canvas / immersive | present | 221 | exports ok |

**The `[VERIFY]` item's premise is disproved.** It assumed these shapes "render no `.markdown`
container at all" and would surface through `unreadableResponseError`. Both named candidates render
one. The real failure is a *present-but-empty* container, which falls to `readExchange`'s
`if (!content) throw unreadableExchangeError()` — so the user is told the conversation *"may still
be loading — wait for it to finish, then try again"*, which is exactly the never-clearing retry loop
that `unreadableResponseError`'s doc comment exists to avoid. Wrong message, and the whole
conversation is still blocked.

The generated image lives in `model-response` beside the empty prose container, as
`generated-image > single-image > img[alt=", AI로 생성"]` (alt is localized and carries no file
name), alongside `image-loading-overlay` and `download-generated-image-button`.

**Canvas is not a failure.** The immersive response keeps its prose summary in `.markdown` and puts
the document behind an `immersive-entry-chip`; the panel's own content is not exported, which is an
omission, not a blocked export. So only the generated-image shape needs the escape marker the item
asked for.

### 2026-07-29 — how a prompt carries a file or an image

Same conversation, prompt = text + a 600×400 PNG + a `.txt`. The attachments sit inside `user-query`
but **outside** `.query-text` (`carouselInsideQueryText` 0, and `.query-text` holds no `<img>`), so
the existing `p.query-text-line` read is not polluted by them:

```
user-query > user-query-file-carousel > user-query-file-preview   (one per file)
```

| | image preview | non-image file |
|---|---|---|
| test id | `uploaded-img` | `uploaded-file` |
| markup | `<img alt="업로드된 이미지 미리보기">` | `filename-label` + `extension-label` |
| name available | **none** | `pv-probe-note` + `TXT` |

`user-query img` came back **1** here. The earlier "0 across every measured conversation" reading
was an artifact of no measured conversation having had an attachment — absence of the case, not
evidence of absence.

Two asymmetries decide what a marker can honestly say. For an **image**, Gemini exposes no file name
anywhere in the tile, and the `alt` is a *localized generic string* — so unlike Claude, where `alt`
IS the name, it must not be read as one; an image attachment can only ever get a generic `[Image]`.
For a **non-image file**, a `[File: pv-probe-note.txt]` marker is reachable, but only by joining
`filename-label` (basename, no extension) with a lowercased `extension-label` (rendered uppercase) —
a derivation, not a verbatim attribute read.

Scope limit: one purpose-built conversation on one account; video, music and Deep Research responses
were not exercised.

### 2026-08-10 — the sidebar pages at 20, append-only, with 1:1 anchor identity

Unblocks the roadmap item "Gemini adapter: bulk/sidebar export", whose blocker was that the sidebar
"was seen in passing … but its paging shape, scroll port, and whether it loads from the server were
never measured". All three are measured now. **This entry unblocks that work; it does not implement
it.** Same session and method as the two Claude entries above; the account held **93 Gemini
conversations**, UI language `ko-KR`.

**The scroll port must be resolved by containment, like Claude's aside.** The document holds two
`infinite-scroller` elements: the message list carries `data-test-id="chat-history-container"` (the
one `selectors.scrollContainer` already pins), and **the sidebar's carries no `data-test-id` at
all**. It is identifiable only as the scroller containing `[data-test-id="conversation"]` nodes.

**Paging shape**, 25 rounds at 1500 ms with the sidebar expanded, scrolling its port to the bottom
each round (only rounds where the count or height moved are shown; all 26 samples were retained and
the aggregates below were reconciled against them):

| Round | rendered | cumulative | scrollHeight |
|---|---|---|---|
| 0 | 31 | 31 | 1248 |
| 1 | 51 | 51 | 1888 |
| 2 | 71 | 71 | 2528 |
| 3 | 91 | 91 | 3168 |
| 4 | 93 | 93 | 3232 |
| 5–25 | 93 | 93 | 3232 |

- **The page size is 20** — three full pages after the initial 31, then a terminal short page of 2.
  The arithmetic closes exactly: 31 + 20 × 3 + 2 = **93**. The geometry says the same thing
  independently: each full page added **640 px = 20 × 32 px**, and the terminal page added
  **64 px = 2 × 32 px**. Treat the 32 px row height as incidental; it is the ratio holding across
  both readings that is the evidence. **The claim is about the deltas only** — the absolute
  heights do not divide out (31 items at 1248 px is 40.3 px each), because the port also carries a
  fixed ~256 px of non-row chrome. Do not derive a row count from an absolute `scrollHeight`.
- **Append-only, no recycling.** Rendered equalled cumulative at every round and finished at 93 = 93,
  so nothing was trimmed off the top. This is the ChatGPT `#history` model, and the **opposite** of
  Gemini's own message list, which pages older turns in on scroll-*up*. Do not carry either
  behaviour across from the other.
- **Every page landed inside a single 1500 ms round** — rounds 1, 2, 3 and 4 each grew, so no page
  needed a second round. That is a bound at this scale and this cadence, not a latency
  distribution; four samples say nothing about the tail, and the shipped dwell should not be sized
  from them.
- The walk settled and **stayed settled for 21 further rounds**, which is the terminal short page
  being confirmed rather than a stall being mistaken for an end.

**Identity is clean and 1:1**, which is what a bulk track needs and what the item never had:

| Measurement | Result |
|---|---|
| `[data-test-id="conversation"]` items | 93 |
| items containing an `a[href^="/app/"]` | 93 |
| distinct ids across those anchors | **93** |
| ids matching `^[0-9a-f]{16}$` | 93 |
| max anchors per item | 1 |
| `a[href^="/app/"]` **outside** a conversation item | **0** |

So a sidebar row is a `gem-nav-list-item[data-test-id="conversation"]` wrapping exactly one anchor
whose href is `/app/<16-hex>` — the same id shape `CONVERSATION_PATH` in
`src/adapters/gemini/matches.ts` already matches. One caveat for whoever implements this: with the
sidebar **collapsed**, a `/app` page still renders 31 conversation items but the earlier probe found
**0** `a[href^="/app/"]` in the document, so the anchors are not reachable until the sidebar is
opened. The open/collapsed distinction is load-bearing and is not something the item anticipated.

Scope limit: one account, 93 conversations, `ko-KR`, one window size. The 20-item page size is
established at this scale, and the terminal short page is the only direct evidence that the walk
terminates at all.

### 2026-08-10 — a Gem is not a project home; Gemini's project analogue is Notebooks

Settles half of the roadmap item "Gemini adapter: Gems / Projects track (`matchesProject` + the
project bulk members)", whose blocker was that "Gemini's Gems and project routes and their list
markup are unmeasured". **The Gems half is resolved as not-applicable.** Same session and account.

- Gems are listed at **`/gems/view`** under `[data-test-id="your-gems-list"]`; the account held one,
  at **`/gem/<12-hex>`**.
- **`/gem/<id>` renders no member list.** Measured on the Gem's own page after a 2.5 s settle:
  `div.conversation-container` **0**, `a[href^="/app/"]` in the content area **0**, with a
  `chat-history-container` present but empty plus a composer and
  `[data-test-id="empty-disclaimer"]`. It is a Gem-scoped **new chat** screen, not a home listing
  that Gem's conversations. There is therefore nothing for `matchesProject` to match and no member
  list to enumerate — the Gems half of the item is not blocked work, it is work that does not exist.
- **Gemini's actual project analogue is Notebooks**, which the item did not name:
  `[data-test-id="notebooks-expandable-section"]` in the sidebar, a `/notebooks/create` entry, and a
  `project-sidenav-list` custom element. **The account has zero notebooks**, so the section rendered
  only its create button and no list markup could be measured. That half stays blocked — on a
  narrower and more accurate blocker than the one it carried.

Conversations belonging to a Gem are not separated in the sidebar in any way this session measured;
whether they are distinguishable there at all is `[unknown — not measured 2026-08-10]`.

## Capturing a fixture

- Fixtures are whole-page HTML (`document.documentElement.outerHTML`) in
  `test/fixtures/chatgpt/`. `test/adapters/chatgpt/extract.test.ts` loads one into happy-dom and
  passes that document to the adapter — passing a non-global document is what makes the adapter
  skip auto-scroll.
- Fixtures are committed to a public repo. Capture only from a conversation you are willing to
  publish, and check the HTML for account identifiers (email, display name, avatar URLs) before
  committing.
