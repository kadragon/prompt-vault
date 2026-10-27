# Share-safe Markdown export

## Problem Statement

A user who solved something with ChatGPT/Claude/Gemini and wants to hand the conversation to a
colleague exports it today with the ordinary backup buttons, then hand-deletes emails, phone
numbers and names from the file. That is tedious and easy to get wrong, and the backup itself
should never be the thing that gets edited. There is no redaction step anywhere in the
extension (checked 2026-10-27: `src/`, `docs/architecture.md`, `docs/PRIVACY.md`, `backlog.md`).

## Solution

A separate **Share-safe Markdown** toolbar button opens a review modal. The modal lists the
emails and phone numbers detected locally in the conversation, lets the user uncheck false
positives and add their own terms (names, company names), shows a live preview, and saves a
**separate** `.md` share copy. The share copy carries a fixed neutral title, a neutral filename,
no source URL, no message ids and no timestamp. The original `Conversation` and the existing
md/pdf/json/html backup path are untouched. The feature never claims the result is anonymized —
detection misses things, and the modal says so.

## User Stories

- As a user sharing a solved problem, I want emails and phone numbers masked for me, so that I do
  not have to scan the whole conversation by hand.
- As a user, I want to uncheck a detection that is not personal data (a sample number in code), so
  that the share copy stays accurate.
- As a user, I want to add my own terms such as a colleague's name, so that what regex cannot
  catch is masked too.
- As a user, I want to see the share copy before it is saved, so that I can catch what detection
  missed.
- As a user, I want my backup exports to stay exactly as they are, so that the share feature can
  never corrupt an archive.
- As a user who never shares, I want to hide the button, like the other toolbar controls.

## Implementation Decisions

**Core — `src/core/share-copy.ts`** (pure, DOM-free, provider-agnostic; it transforms a
`Conversation` into a `Conversation`, so it sits beside the model, not in `src/export/`):

- `findShareCandidates(conversation)` → candidates `{ kind: 'email' | 'phone', text,
  messageIndex, start, end }` over each `message.content`. The title is not scanned: it is
  replaced wholesale (below).
- `createShareCopy(conversation, { excluded, manualTerms, neutralTitle })` → a new
  `Conversation`. `excluded` identifies unchecked candidates by `(messageIndex, start, end)`.
  `neutralTitle` is passed in by the caller because core cannot call `chrome.i18n`.
- **Single-pass replacement on the original text.** Spans from the kept candidates and from
  manual-term matches are collected against the *original* content, overlaps are resolved
  (earliest start wins the token, and the merged span covers the union so a later overlapping
  span leaves no unmasked tail), and the spans are replaced once. Replacing
  sequentially would let a manual term such as `email` match the inserted `[EMAIL]` token and
  produce `[[REDACTED]]`.
- Tokens: email → `[EMAIL]`, phone → `[PHONE]`, manual term → `[REDACTED]`.
- Email detection: the common `local@domain.tld` shape.
- Phone detection: Korean mobile/landline numbers with `-`, `.` or space separators
  (`010-1234-5678`, `02.123.4567`, `010 1234 5678`) and `+`-country-code international numbers.
  Bare digit runs are **not** matched — they collide with dates, ids and amounts; the unchecking
  UI absorbs the remaining false positives, so the patterns may lean broad within that rule.
- Manual terms: case-insensitive literal match (regex metacharacters escaped), longest term
  first, empty/whitespace-only terms ignored.
- Scope: the whole `content`, code blocks included — contact details appear in code too.
- Share copy shape: `title = neutralTitle`, `url = ''`, `createdAt` omitted, each message's `id`
  omitted, `role` kept. Built fresh; the input object and its messages are never mutated.

**Filename — `src/export/filename.ts`:** a share-specific builder returning
`{provider}-shared-{yyyymmdd}.md`. It does not go through the title slug, because the neutral
title is localized and would otherwise put a different word in the filename per locale.

**Rendering:** the share copy goes through the existing `toMarkdown()` unchanged, and is saved
with the existing `downloadTextFile()`. No notice text is added inside the file.

**UI — `src/content/share-panel.ts`:** a **modal** following the `bulk-panel.ts` recipe
(`docs/conventions.md` → *Injected page UI*): backdrop, `aria-modal="true"`, focus moved in on
open, document-level Escape, its own stable element id, and every teardown path unbinds what it
bound. Contents: a warning that detection can miss items and the preview must be checked; the
candidate checklist (all checked by default, kind + matched text); a manual-term input with an
add control; a read-only preview of `toMarkdown(shareCopy)` refreshed on every change; Save and
Cancel. Opening is a user gesture, so taking focus is correct here.

**Toolbar — `src/content/mount.ts`:** one more button after the per-format buttons, opened via
the same extract + `assertConversationNonEmpty` + fail-loud alert path as `runExport`
(AGENTS.md #4), sharing the in-flight guard so it cannot race a download.

**Settings — `src/settings/store.ts` / `src/options/view.ts`:** `ToolbarSettings` gains
`share: boolean`, default `true`; `sanitize` fills a missing/non-boolean value with the default,
exactly as for `bulk`. The options page gets a matching checkbox.

**Privacy:** detection and replacement run in the content script; the term list and candidate
choices live only in the modal's closure and are dropped on close — never written to
`chrome.storage`, `localStorage` or anywhere else, never sent anywhere (Golden Principle #1).
No new permission.

**Strings:** every new string goes through `src/strings.ts` into all five catalogs, written in
each target language. Nothing anywhere says "anonymized" or implies completeness.

## Alternatives rejected

- A "share mode" toggle on the existing Markdown button — mixes the share copy into the backup
  path, the one thing the feature must keep separate.
- An options-level switch that masks every export automatically — removes the review step, and
  silently changes what the backup buttons produce.
- Masking the original title instead of replacing it — auto-generated titles routinely carry
  company/project names no regex catches; a fixed title leaves nothing to miss.
- Sequential replacement (regex tokens first, manual terms after) — manual terms can match the
  inserted tokens (see the single-pass decision).
- Detecting bare digit runs as phone numbers — too many collisions with dates, ids and amounts.
- Adopting NVIDIA SkillSpector for detection — its default LLM analysis and OSV lookups send data
  out, which Golden Principle #1 forbids; only its "static detect, then human review" shape was
  borrowed.

## Testing Decisions

- Vitest unit tests for `src/core/share-copy.ts`, written first: synthetic emails, phone numbers
  (each accepted format, plus bare digit runs that must survive) and manual terms are absent from
  the share copy's title and body and replaced by their tokens; the input `Conversation` deep-
  equals a `structuredClone` taken before the call; `url` is empty, `createdAt` and every message
  `id` are absent; an excluded candidate is left as-is; overlapping candidate/term spans and a
  term that spells a token (`email`) produce no nested tokens; terms match case-insensitively and
  longest-first.
- Vitest for the filename builder: `{provider}-shared-{yyyymmdd}.md`, title-independent.
- An end-to-end core test drives the share copy through the real `toMarkdown()` and asserts no
  synthetic value survives in the rendered bytes.
- Regression: existing `test/export/*` and `test/content/save-conversation.test.ts` stay green
  unchanged — the backup path's bytes must not move.
- happy-dom tests for the modal: candidates render checked, unchecking updates the preview,
  adding a term updates the preview, Save calls the download with the share filename and the
  previewed text, Cancel/Escape/backdrop all tear down listeners, and nothing is written to
  `chrome.storage`.
- Settings tests: `share` defaults to `true`, `sanitize` repairs a missing or non-boolean value;
  the toolbar omits the button when it is off.
- `test/i18n/message-keys.test.ts` and `test/privacy/*` stay green.
- Visual check of the modal on the loaded extension per `docs/live-dom-verification.md`.
- Gate: `npm run lint && npm run typecheck && npm test` (see `docs/runbook.md`).

## Out of Scope

- Share copies in PDF, JSON or HTML.
- Share mode inside bulk or project export.
- Further detectors (resident registration numbers, card numbers, IP addresses, addresses).
- Editing the title inside the modal.
- Remembering the term list across sessions or conversations.

## Further Notes

- A masked email inside a Markdown link (`[a@b.com](mailto:a@b.com)`) renders as a link labeled
  `[EMAIL]` pointing at `mailto:[EMAIL]` — nothing leaks, so it is accepted as-is.
- Whether the store listings should advertise the feature is a separate `[DOCS]` decision after
  it ships; `docs/PRIVACY.md` needs no change because no data leaves the page and nothing new is
  stored.
- Follow-up candidates once real use shows demand: the extra detectors in Out of Scope.
