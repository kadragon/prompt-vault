# Live-DOM Verification (ChatGPT)

Unit tests run against frozen fixtures, so they can never tell you that ChatGPT's markup moved.
Only a session against the live, logged-in page can. Entries in
`src/adapters/chatgpt/selectors.ts` should carry a `Verified against the live page (YYYY-MM-DD)`
stamp — this doc is how that stamp gets earned. Coverage is currently partial: some entries are
stamped only `verified against the captured fixtures` (weaker — a fixture cannot detect drift), and
the oldest ones carry no per-entry stamp at all, inheriting only the file header. Treat an unstamped
or fixture-only entry as unverified, not as verified-by-default.

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

## Recording the result

A verification that isn't recorded gets redone next month.

- Stamp the selector(s) in `selectors.ts` with the date and what was confirmed.
- Resolve the `tasks.md` `[VERIFY]` item with the evidence — concrete numbers, not "looks fine".
  A verification that *disproves* the premise is a result: say so and close the item.
- Commit `[DOCS]`.

## Capturing a fixture

- Fixtures are whole-page HTML (`document.documentElement.outerHTML`) in
  `test/fixtures/chatgpt/`. `test/adapters/chatgpt/extract.test.ts` loads one into happy-dom and
  passes that document to the adapter — passing a non-global document is what makes the adapter
  skip auto-scroll.
- Fixtures are committed to a public repo. Capture only from a conversation you are willing to
  publish, and check the HTML for account identifiers (email, display name, avatar URLs) before
  committing.
