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
- **The MCP browser cannot load the unpacked extension.** Anything that needs the extension's own
  UI (toolbar buttons, bulk panel, download behavior) is a manual load-unpacked session — see
  `docs/runbook.md`. A live-DOM session verifies *DOM assumptions*, not shipped UI.

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

## Capturing a fixture

- Fixtures are whole-page HTML (`document.documentElement.outerHTML`) in
  `test/fixtures/chatgpt/`. `test/adapters/chatgpt/extract.test.ts` loads one into happy-dom and
  passes that document to the adapter — passing a non-global document is what makes the adapter
  skip auto-scroll.
- Fixtures are committed to a public repo. Capture only from a conversation you are willing to
  publish, and check the HTML for account identifiers (email, display name, avatar URLs) before
  committing.
