# ChatGPT Conversation Backup (prompt-vault v1)

## Problem Statement

Users of AI chat products have no first-class way to keep a durable, portable copy of a
conversation. ChatGPT's built-in options are limited and lock the content into the product. People
want their own local archive — searchable, shareable, outside any single vendor — without trusting a
third-party service with the conversation content.

prompt-vault is a Manifest V3 browser extension that solves this locally: on a conversation page it
adds a **Download** control that exports the current conversation to **Markdown** or **PDF**, entirely
in the browser. ChatGPT is the first target; the design is built to extend to Gemini and Claude, and
to a later bulk-export mode, without reworking the core.

## Solution

A layered, adapter-based extension. The content script detects a supported conversation page and
mounts a Download button. A per-site **adapter** scrapes the page DOM into a provider-agnostic
**Conversation** model. Two **exporters** turn that model into a Markdown file or a PDF file. All
processing is local; no conversation data ever leaves the browser.

```
content script (per-site injection, mounts UI)
      ▼
site adapter  src/adapters/{provider}/   — implements ConversationAdapter
      ▼
core model    src/core/                    — Conversation, Message (provider-agnostic)
      ▼
exporters     src/export/markdown.ts, pdf.ts   — consume Conversation only, never DOM
```

Dependencies point downward only. The `Conversation` model is the single contract between scraping
and rendering, so a new provider is a new adapter directory and a new host entry — zero changes to
core or exporters.

## User Stories

- As a ChatGPT user, on a conversation page I want a **Download** button top-right so I can save the
  chat without leaving the page.
- As a user, I want to choose **Markdown or PDF** so I can pick an editable archive or a portable
  document.
- As a user with a **long conversation**, I want the whole history captured — not just what is
  currently on screen — so my archive is complete.
- As a privacy-conscious user, I want the export to happen **entirely in my browser**, so my
  conversation is never uploaded anywhere.
- As a user, if extraction fails I want a **clear error**, not a silent empty file, so I know the
  backup didn't work.
- *(Roadmap)* As a user, I want to **bulk-export many conversations** in one pass, so I can archive my
  whole account.

## Implementation Decisions

**Build & tooling** — Vite + TypeScript, bundling to `dist/`. TypeScript gives a type-safe
`Conversation` model shared across adapters and exporters (pays off across three future providers).
npm dependencies (pdfmake) require bundling anyway. v1 is loaded via `chrome://extensions` →
Load unpacked; the manifest is kept in a Web-Store-submittable shape but submission is deferred.

**Manifest V3, least privilege** — MV3 with a content script matched only to supported ChatGPT hosts.
`host_permissions` narrow to those hosts. `downloads` permission for saving files. No `<all_urls>`, no
broad `tabs`/`scripting` grants. No remote code (CSP): everything runs from the bundled package.

**Adapter isolation** — Each provider lives in `src/adapters/{provider}/` and exports a single
`ConversationAdapter`: `matches(url): boolean`, `extract(): Promise<Conversation>`, and a centralized
`selectors` object (every DOM selector appears exactly once, so a site change is a one-line fix).
ChatGPT ships in v1; Gemini and Claude are sibling directories added later with no core/export change.

**Normalized model** — `src/core/conversation.ts` defines
`Conversation { title, provider, url, createdAt?, messages: Message[] }` and
`Message { role: 'user'|'assistant'|'system', content, parts? }`. This is the only type adapters and
exporters share.

**Markdown exporter** — `src/export/markdown.ts`, a pure `Conversation → string`. Preserves role,
message order, fenced code blocks (with language when detectable), lists, bold/italic, and links;
images render as Markdown image links; tables best-effort. Deterministic output (same conversation →
same bytes).

**PDF exporter** — `src/export/pdf.ts` builds a **pdfmake** document definition from the
`Conversation` model, producing a vector-text PDF (selectable text, code blocks in a monospace block)
that downloads directly with **no print dialog**. This choice is deliberate: the roadmap bulk-export
mode must save many files without per-file user interaction, which the `window.print` pipeline cannot
do. Formatting is a deterministic manual mapping from the model, not a DOM screenshot.

**Full-history capture** — Before extraction the adapter auto-scrolls the conversation container to
force lazy-rendered (virtualized) messages into the DOM, then extracts. If extraction yields an empty
or malformed conversation, the UI surfaces a **visible error** — never a silent/empty download
(golden principle: fail loud).

**Download mechanism** — Local only: build a `Blob`, save via `URL.createObjectURL` + an `<a download>`
(or the `downloads` API). Filename `chatgpt-{safe-title}-{yyyymmdd}.{ext}` (sanitized title).

**UI** — A non-intrusive Download button injected top-right in the conversation header, shown only on
conversation pages (URL path `/c/<id>`). Clicking offers Markdown and PDF.

## Testing Decisions

- **Exporters + core model** — pure functions; unit-tested directly (Vitest). Markdown output is
  asserted against fixtures; PDF exporter is asserted at the pdfmake document-definition level (the
  structured object), not the rendered bytes.
- **Adapters** — depend on live DOM, so tested against **saved HTML fixtures** in
  `test/fixtures/chatgpt/` (short, long/virtualized, code-heavy, empty), never the live site — keeps
  tests deterministic. Refresh a fixture when ChatGPT's DOM changes.
- **Privacy invariant** — a test/grep gate asserts no `fetch`/`XMLHttpRequest`/`sendBeacon` to any
  external origin in `src/adapters`, `src/export`, `src/content`.
- **Manual verification** — load-unpacked, open a real ChatGPT conversation, export both formats,
  confirm fidelity vs. on-screen content and that a long conversation is fully captured.
- **Commands** — `npm run build`, `npm run lint`, `npm test` (exact scripts finalized with the
  scaffold; recorded in `docs/runbook.md`).

## Out of Scope

- Gemini and Claude adapters (roadmap — additive per adapter isolation).
- Bulk / multi-conversation export (roadmap — export layer is designed programmatic so it isn't
  precluded, but not built in v1).
- Chrome Web Store submission (icons, listing, privacy policy, review) — v1 is load-unpacked.
- Formats beyond Markdown and PDF (JSON/HTML), and i18n of UI strings.
- Cloud sync, accounts, or any server component.
- Editing/annotating conversations — export only.

## Further Notes

- **Risk: DOM churn.** ChatGPT's DOM changes without notice; extraction is the most fragile part.
  Mitigations: centralized selectors, fixture-based tests, fail-loud on empty extraction. Verify
  selectors against the live page before committing an adapter.
- **Risk: very long conversations.** Auto-scroll may need a stable "reached top/bottom" signal and a
  bounded number of scroll steps to avoid infinite loops; treat a scroll timeout as a fail-loud case.
- **Risk: pdfmake bundle size / fonts.** pdfmake ships vfs fonts; keep the bundle lean and confirm CJK
  (Korean) glyphs render, since conversations may be Korean — embed a CJK-capable font if needed.
- **Forward hook for bulk export.** Keep the export functions callable headlessly (given a
  `Conversation`, produce+save a file with no UI prompt) so the future bulk driver just iterates
  conversations and reuses them.
