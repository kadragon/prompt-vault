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
| ChatGPT `#history` page latency (**1502–7516 ms**, re-measured 2026-07-28; was 1418–2830 ms on 2026-07-24) | `SIDEBAR_SCROLL_DEFAULTS` dwell, and the sizing of Gemini's `END_SETTLE_ROUNDS` | A slower backend than the dwell truncates silently on both providers. **No longer hypothetical** — measured 2026-07-25 at 725 of 852 conversations, silently, on the first Load more run (recorded below). The 2026-07-28 re-measurement found gaps **above the shipped 5 s dwell in both of two runs**, so the upper bound is not a tail event. |

## Tooling reality (read before promising anything)

The Playwright MCP server is **not repo-owned** — this repo checks in no `.mcp.json`. It comes from
a user-scoped Claude plugin (`playwright@claude-plugins-official`), configured with no flags —
`{"command": "npx", "args": ["@playwright/mcp@latest"]}`. On another machine or a fresh checkout it
may be absent or configured differently; confirm it is available before promising a live session,
and re-read its config rather than assuming the flags below.

- **The login does not survive.** With no `--user-data-dir`, `--help` states "a temporary directory
  will be created" — a fresh profile per run. Every session starts logged out. Ask the user to log
  in; never try to reuse, read, or transplant their credentials.
- Two ways to avoid the re-login, **neither currently configured** (each needs an MCP config change,
  so propose it, don't assume it):
  - `--user-data-dir <path>` pinned to a stable directory, so the profile persists.
  - `--extension` — attach to the user's already-running Chrome. Requires the "Playwright
    Extension" to be installed (Edge/Chrome only).
- **The MCP browser CAN run the unpacked extension** — corrected 2026-07-25, having been recorded
  here as impossible, which deferred four items on a false premise — three `[VERIFY]`s and one
  `[CONSTRAINT]`. The MCP config
  passes no `--load-extension`, but the browser it launches is an ordinary Chromium whose
  extensions page is available, so loading `dist/` by hand in the *running* browser works and the
  content script injects normally. **Read that narrowly:** the capability is per-session, not
  persistent. The profile is temporary (see the login bullet above), so the by-hand load is a human
  step that repeats every run, exactly like the login — what became automatable is everything
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
| `scrollHeight` increment per batch | **35 × 1008 px**, then 1 × 396 px | **35 × 1008 px**, then 1 × 396 px |
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
anchors, 871 against 868 — so placeholder rows exist during a pending page and reconcile afterwards.
An oracle counting `li` would read a phantom increment; **count anchors.**

**Why the loader cannot see this today, stated as measured numbers.** The per-batch increment in
*top-level `/c/` ids* — what `collectConversations` counts — ranged **11 to 27** and was never once
28:

| Increment | Raw rows (`a[href]`) | Top-level `/c/` only |
|---|---|---|
| Distinct values across 74 batches | **1** (28, plus the terminal 11) | **13** (11…27) |

This is the premise the backlog item recorded as the reason parity was unusable, now measured rather
than inferred: the 190 project/GPT-scoped rows are interleaved unpredictably, so the `/c/` delta is a
*sample* of a 28-row page, not its size.

**What this buys the oracle, and its one edge case.** "Last increment == 28 ⇒ another page exists" is
sound but **asymmetric, and that asymmetry is the whole point**: a short page (the terminal 11 here)
proves exhaustion, while a *full* page proves nothing either way. A list whose total is an exact
multiple of 28 therefore ends on a full page, and only the following empty page reveals the end — so
the rule must be "keep pulling until a page arrives short **or empty**", never "a full page means
keep going, anything else means stop". Design the fix around that, not around the happy path.

**Latency, re-measured (the row in "Re-measure these numbers" above).** Inter-batch gaps: min
**1502 ms**, median **3011–4504 ms** (one per run), max **7516 ms**. One caveat on the minimum: each
run's *first* record is timed from page load rather than from a preceding batch, so it is not strictly
an inter-batch gap. In run 2 the minimum was an interior record (1509 ms at round 5) against a first
record of 3002 ms, so it is not an artifact of that; run 1's per-batch ordering was not retained to
check the same way. **Gaps exceeding the shipped 5 s dwell
occurred in both runs** — 3 of 37 and 2 of 37 — and every one of them landed while the container was
already clamped (`settled: true`), which is the exact state `scrollUntilStable` counts stalls in.

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

  The adapter uses a subset (dropping `px-md`, a *labeled* control's padding, plus the
  `disabled:`/`aria-*` state variants). A class string is the one kind of captured value nothing
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

**Still unverified, and deliberately not guessed at** (tracked in `backlog.md` / `tasks.md`):

- **What a landing batch does to `scrollTop`.** A browser preserving visual position shifts the
  viewport down by the prepended height; scroll anchoring turned off, or a virtualizer managing its
  own spacer, would leave `scrollTop` at 0. The live walks only ever observed batches landing while
  the walk was still climbing, so neither outcome was isolated. The walk is written to survive both
  — that is what the settle condition's "is the list still changing?" term is for, and the test
  fake models both shapes explicitly (`batchLandingShiftsViewport`).
- **Responses that render no `.markdown` at all.** Every measured response was prose and code. A
  generated image or a canvas/immersive panel plausibly renders outside the prose container, and one
  such response currently fails the whole export — loudly, with a "please report this" message
  rather than the retry advice that could never clear it, but it does block the conversation.
  Tracked as a `[VERIFY]` in `tasks.md`.
- **Prompts carrying files or images.** `user-query img` was 0 across every measured conversation,
  so how an attachment tile renders — and whether it sits inside `user-query` at all — is unknown.
  Guessing a tile selector would risk reporting a fabricated file name (AGENTS.md #5).
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

## Capturing a fixture

- Fixtures are whole-page HTML (`document.documentElement.outerHTML`) in
  `test/fixtures/chatgpt/`. `test/adapters/chatgpt/extract.test.ts` loads one into happy-dom and
  passes that document to the adapter — passing a non-global document is what makes the adapter
  skip auto-scroll.
- Fixtures are committed to a public repo. Capture only from a conversation you are willing to
  publish, and check the HTML for account identifiers (email, display name, avatar URLs) before
  committing.
