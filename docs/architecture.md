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
  `matches(url): boolean`, `extract(): Conversation`, plus centralized `selectors`. ChatGPT first;
  Gemini and Claude are added as sibling directories with zero changes to core/export.
- `src/export/markdown.ts` / `pdf.ts` — pure functions `Conversation → Blob/string`. No DOM access.
- `src/content/` — content-script entry: pick the adapter whose `matches()` is true, mount the
  download button, wire it to the exporters.
- `manifest.json` — MV3. `content_scripts` matches only supported hosts; `host_permissions` narrow.

## Adding a provider (the extension path)

1. Create `src/adapters/{provider}/` with a `ConversationAdapter` + selectors.
2. Register it in the adapter registry.
3. Add the host to `manifest.json` `content_scripts.matches` + `host_permissions`.
4. No change to `src/core/` or `src/export/` — if you need to, the boundary is wrong.

## Open design decisions (resolve in `plan`)

- PDF generation approach (client-side lib vs. print pipeline) — `[unknown — decide in spec]`.
- Build tooling (plain files vs. Vite/esbuild + TS) — `[unknown — decide in spec]`.
- How to capture full history for long/virtualized conversations (lazy-rendered messages).
