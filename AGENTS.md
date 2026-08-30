<!-- commit-guard: allow-main -->
<!-- Solo repo: planning/harness commits go direct to main. Implementation still uses a
     feature branch per the docs/workflows.md `code` cycle (Step 0). -->

# prompt-vault Agent Rules

Browser extension (Manifest V3) that backs up AI chat conversations to local files
(Markdown / PDF / JSON / HTML). Supports ChatGPT, Claude and Gemini via per-site adapters;
bulk export works on all three; project export is ChatGPT and Claude only.
All processing is local — conversation data never leaves the browser.

## Docs Index (read on demand)

| File | When to read |
|------|--------------|
| `docs/architecture.md` | Before adding a site adapter, export format, or changing module boundaries |
| `docs/conventions.md` | Before writing content scripts, adapters, or export code |
| `docs/workflows.md` | When starting any implementation cycle (the `code` cycle lives here) |
| `docs/delegation.md` | Before delegating to sub-agents |
| `docs/eval-criteria.md` | When writing a Sprint Contract or evaluating a completed feature |
| `docs/runbook.md` | For build, load-unpacked, test, and package commands |
| `docs/live-dom-verification.md` | Before verifying selectors — or the loaded extension's own rendered UI — against the logged-in live page, or capturing a fixture |
| `docs/store-listing.md` (+ `docs/store-listing/{en,ko,zh_CN,zh_TW,ja}.md`) | Before preparing or updating a Chrome Web Store submission; the per-locale files hold the summary and description copy, and a listing locale requires the matching `public/_locales` catalog |
| `docs/harness-log.md` | When auditing the harness, or before changing a rule a past edit predicted |
| `docs/PRIVACY.md` | Before changing data handling, permissions, or store privacy disclosures |

## Golden Principles

Invariants that, if broken, cause the most damage. Keep them true.

1. **Local-only, no exfiltration** — the extension MUST NOT send conversation content to any
   network endpoint. No `fetch`/`XHR`/`sendBeacon` to external hosts; no analytics. Host
   permissions limited to supported chat sites. Grep gate: no outbound calls in any JS/TS file under `src/`.
2. **Least-privilege Manifest V3** — MV3 only; request the minimum permissions and narrowest
   `host_permissions` needed. No `<all_urls>`, no broad `tabs`/`scripting` grants without cause.
3. **Adapter isolation** — every provider (ChatGPT/Gemini/Claude) implements the shared
   `ConversationAdapter` interface in its own module under `src/adapters/{provider}/`. No
   provider-specific selectors or DOM logic outside that provider's adapter.
4. **Fail loud on extraction** — DOM selectors are centralized per adapter. If extraction yields
   an empty or malformed conversation, surface a visible error — never produce a silent/empty download.
5. **Agent Integrity** — never fabricate a selector, API name, permission, or path. Mark unverified
   values `[unknown — read {source} to verify]` rather than guessing. DOM selectors of live sites
   change; verify against the actual page, do not assume.

## Delegation

`docs/delegation.md` **owns** the objective-trigger routing table and the Spawn Prompt Contract —
read it before delegating; the triggers are deliberately not copied here (they were duplicated in
four places and drifted). Solo/greenfield repo — **the lead implements by default**; a Sprint
Contract is not a delegation trigger. The one hard rule, restated because it is never optional:
whoever implemented must not verify their own work.

## Token Economy

1. Do not re-read a file already read this session, and do not call a tool to confirm what you
   already know; re-check only the changed region.
2. Delegate analysis that would flood context (>20 lines of raw output); keep only the conclusion.
3. Do not restate the user's message.

## Working with Existing Code

- Live-site DOM is unstable — never hardcode a selector without verifying it against the current page
  (Playwright MCP or a saved fixture). Centralize selectors in the adapter, never inline.
- Manifest permission changes are security-relevant — justify every added permission in the PR.
- Export format code (md/pdf) must be provider-agnostic: it consumes the normalized `Conversation`
  model, never raw site DOM.

## Language Policy

- User-facing UI strings: English first; Korean when i18n is added.
- Korean *prose* shipped to users — store listing copy, release/announcement posts — goes through
  the `humanize-korean` skill before it lands. Drafting it inline reads as machine-translated.

## Maintenance

Update this file **only** when ALL are true:

1. Not directly discoverable from code / config / manifest / docs.
2. Operationally significant — affects build, security, or runtime behavior.
3. Would likely cause mistakes if left undocumented.
4. Stable, not task-specific.

**Never add:** architecture summaries, directory listings, tooling-enforced style, or temporary notes.
Prefer editing/removing stale entries over appending. Size budget: ≤100 lines; move detail to `docs/*`.

**Memory boundary:** durable repo facts live here and in `docs/` (version-controlled). Claude Code
auto-memory (`MEMORY.md`) holds only cross-session preferences — never promote a code fact into it.
