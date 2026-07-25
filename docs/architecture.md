# Architecture

> Status: greenfield. Concrete tooling (bundler, PDF library) is decided in
> `docs/design/{slug}.md` during the `plan` workflow, then reflected here.

## What this is

A Manifest V3 browser extension. On a supported chat site's conversation page it injects a
**Download** control (top-right); the user exports the current conversation as **Markdown** or
**PDF**. All extraction and rendering happen locally in the browser.

## Layers & dependency direction

```
content script (per-site injection)
      │  detects supported page, mounts UI
      ▼
site adapter  (src/adapters/{provider}/)   ── implements ConversationAdapter
      │  scrapes DOM → normalized Conversation model
      ▼
core model    (src/core/)                   ── Conversation, Message (provider-agnostic)
      │
      ▼
exporters     (src/export/)                 ── markdown.ts, pdf.ts  (consume Conversation only)
```

**Rule:** dependencies point downward only. Exporters never import an adapter; adapters never
import an exporter. The `Conversation` model is the single contract between scraping and rendering.

## Key module boundaries

- `src/core/conversation.ts` — the normalized model. `Conversation { title, provider, url,
  createdAt?, messages: Message[] }`, `Message { role: 'user'|'assistant'|'system', content,
  parts? }`. This is the ONLY type exporters and adapters share.
- `src/adapters/{provider}/` — one directory per provider. Must export a `ConversationAdapter`:
  `matches(url): boolean`, `extract(): Conversation`, plus centralized `selectors`. ChatGPT and
  Claude ship today; Gemini is added as a sibling directory with zero changes to core/export.
  Only `provider`/`matches`/`extract` are required — a provider implements as much of the rest
  (toolbar mount, sidebar bulk, projects) as its DOM has been *verified* to support. An optional
  member being absent does NOT by itself hide the feature: the content layer must check for it.
  `src/content/mount.ts` gates the bulk icon on `listConversations` + `openConversation` and the
  project trigger on `matchesProject`. Adding an optional member to the interface means adding
  that check too, or a provider will advertise a control it cannot service.
- `src/core/html-to-markdown.ts` — the shared DOM→GFM serializer every adapter feeds its own
  prose container to. It lives in core, not in an adapter, because adapter isolation forbids one
  adapter importing another's module; it must stay free of provider-specific selectors.
- `src/export/markdown.ts` / `pdf.ts` — pure functions `Conversation → Blob/string`. No DOM access.
- `src/content/` — content-script entry: pick the adapter whose `matches()` is true, mount the
  download button, wire it to the exporters.
- `manifest.json` — MV3. `content_scripts.matches` lists only supported hosts and is the *only*
  thing granting host access: there is no `host_permissions` (dropped 2026-07-25 by experiment —
  see `manifest.config.ts` and `docs/live-dom-verification.md`).

## Adding a provider (the extension path)

1. Create `src/adapters/{provider}/` with a `ConversationAdapter` + selectors.
2. Register it in the adapter registry.
3. Add the host to the `HOSTS` list in `manifest.config.ts` — that feeds `content_scripts.matches`,
   which is all a statically declared content script needs. Do **not** add `host_permissions`;
   `test/privacy/manifest-least-privilege.test.ts` fails if you do.
4. No change to `src/core/` or `src/export/` — if you need to, the boundary is wrong.

## Resolved / open design decisions

- **Build tooling — RESOLVED (ticket 1):** Vite + TypeScript + `@crxjs/vite-plugin`, bundling to
  `dist/`. The content script runs in the isolated world. SPA route changes are detected by polling
  `location.href` (plus a `popstate` listener) inside that isolated script — `location` reflects the
  current URL across worlds, so no main-world injection is needed. (A `world: 'MAIN'` history hook was
  tried first but crxjs loads such scripts via a relative dynamic `import()` that resolves against the
  page origin and lacks `chrome.runtime`, so it fails to load — polling is the robust alternative.)
- PDF generation approach — decided in the design doc (pdfmake); reflected here when ticket 5 lands.
- How to capture full history for long/virtualized conversations (lazy-rendered messages) — ticket 3.
