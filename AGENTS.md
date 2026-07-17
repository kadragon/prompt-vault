# prompt-vault Agent Rules

Browser extension (Manifest V3) that backs up AI chat conversations to local files
(Markdown / PDF). First target: ChatGPT. Designed to extend to Gemini and Claude via
per-site adapters. All processing is local — conversation data never leaves the browser.

## Docs Index (read on demand)

| File | When to read |
|------|--------------|
| `docs/architecture.md` | Before adding a site adapter, export format, or changing module boundaries |
| `docs/conventions.md` | Before writing content scripts, adapters, or export code |
| `docs/workflows.md` | When starting any implementation cycle (the `code` cycle lives here) |
| `docs/delegation.md` | Before delegating to sub-agents |
| `docs/eval-criteria.md` | When writing a Sprint Contract or evaluating a completed feature |
| `docs/runbook.md` | For build, load-unpacked, test, and package commands |

## Golden Principles

Invariants that, if broken, cause the most damage. Keep them true.

1. **Local-only, no exfiltration** — the extension MUST NOT send conversation content to any
   network endpoint. No `fetch`/`XHR`/`sendBeacon` to external hosts; no analytics. Host
   permissions limited to supported chat sites. Grep gate: no outbound calls in export/adapter code.
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

Read `docs/delegation.md` for the routing table and Spawn Prompt Contract. Solo/greenfield repo —
most work is inline. Objective triggers to delegate: target area >5 files or first exploration of an
adapter's DOM structure → `explorer`; after implementation → `qa-verifier` (implementer must NOT
verify its own work); feature complete → `product-evaluator`.

## Token Economy

1. Do not re-read a file already read this session; re-check only the changed region.
2. Do not call tools to confirm what you already know.
3. Run independent tool calls in parallel.
4. Delegate analysis that would flood context (>20 lines of raw output); keep only the conclusion.
5. Do not restate the user's message.

## Working with Existing Code

- Live-site DOM is unstable — never hardcode a selector without verifying it against the current page
  (Playwright MCP or a saved fixture). Centralize selectors in the adapter, never inline.
- Manifest permission changes are security-relevant — justify every added permission in the PR.
- Export format code (md/pdf) must be provider-agnostic: it consumes the normalized `Conversation`
  model, never raw site DOM.

## Language Policy

- Code, commits, comments, docs: English.
- User-facing UI strings: English first; Korean when i18n is added.

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
