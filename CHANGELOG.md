# Changelog

## Unreleased

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
