# Chrome Web Store — Listing & Submission

Dashboard-ready copy and asset checklist for **Prompt Vault**. Copy fields below verbatim.
Items marked **[human-only]** require a logged-in ChatGPT session or Chrome Web Store
Developer Dashboard access.

## Store listing fields

| Field | Value |
|-------|-------|
| **Name** | Prompt Vault — AI Chat Backup |
| **Category** | Productivity |
| **Default language** | English |

Name and category are shared by every locale. The summary, description and screenshots are
per-locale and live in one file each — paste from the file for the locale you are editing:

| Locale | File | Screenshots |
|--------|------|-------------|
| `en` (default) | [`store-listing/en.md`](store-listing/en.md) | `assets/store/screenshot-*.png` |
| `ko` | [`store-listing/ko.md`](store-listing/ko.md) | `assets/store/ko/screenshot-*.png` |
| `zh_CN` | [`store-listing/zh_CN.md`](store-listing/zh_CN.md) | none — falls back to the English set |
| `zh_TW` | [`store-listing/zh_TW.md`](store-listing/zh_TW.md) | none — falls back to the English set |
| `ja` | [`store-listing/ja.md`](store-listing/ja.md) | none — falls back to the English set |

**A listing locale exists only if the package ships it.** The dashboard offers a localized
listing for the locales the extension itself supports — "you will be able to provide a
description, screenshots, and promotional video in the locales your extension supports"
([source](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), checked
2026-08-30). So a listing locale is downstream of a `public/_locales/<locale>/messages.json`
catalog, never a substitute for one; adding listing copy alone leaves the language absent from
the dashboard and from the store page's language list. `test/i18n/message-keys.test.ts`
enumerates the locale directories, so every catalog is gated the moment it is added.

A change to what the product *does* is a change to every locale file — the store warns on
localized metadata that describes a different feature set.

### Single-purpose statement (Privacy tab)

```
Prompt Vault has one purpose: to export the user's own AI chat conversations to local
Markdown, PDF, JSON, or HTML files. It supports ChatGPT, Claude and Gemini. The user exports the
open conversation or, on ChatGPT and Claude, selects a set of conversations from the sidebar
or a project list — and on Claude also from the full history page — through the optional bulk
action. The extension reads conversation content only in response to that user action and
only to create local downloads.
```

**Check every quality claim against the repo's own caveats before it ships.** Listing copy and
screenshot captions are product claims, and the code records where it cannot keep them: adapter
doc comments (`src/adapters/gemini/index.ts` on the residual silent-truncation hazard) and open
`backlog.md` items. This cycle produced both failure modes in one pass — a "nothing silently
truncated" bullet the loaders explicitly disclaim, and a fidelity screenshot displaying two
filed rendering defects. Grep the backlog and the adapter comments for the subject of any
absolute claim; prefer "fails loud" over "never fails".

## Privacy and permission declarations

Use these explanations in **Dashboard → Privacy**. Re-check them whenever permissions or
data handling change.

| Permission / practice | Justification |
|-----------------------|---------------|
| `storage` | Persists toolbar and bulk-export visibility preferences through `chrome.storage.sync`, and a single local flag recording that the one-time toolbar-pinning tip was dismissed through `chrome.storage.local`. No conversation content is stored. |
| Host access `https://chatgpt.com/*`, `https://claude.ai/*`, `https://gemini.google.com/*` | Injects export controls into ChatGPT, Claude and Gemini, and reads conversations selected by the user for local export. These are the only sites on which the extension runs. Each host corresponds to one registered adapter in `src/adapters/`. The Gemini entry is scoped to the `gemini.google.com` subdomain, not `google.com`, so it grants no access to any other Google service. The access comes solely from `content_scripts.matches` — the manifest declares no `host_permissions`, so the extension holds no cross-origin fetch or cookie access on these hosts. |
| Remote code | Not used. All executable code and the PDF font are bundled in the extension package. |
| Conversation content | Processed locally only after an export action; not retained by the extension or transmitted to the developer or a third party. |

Data-use declarations:

- **Does this item collect or use user data?** Yes. Chrome's policy treats reading or
  processing website content as handling user data even when everything stays on the
  user's device.
- Select **Website content** and **Personal communications**: the extension reads the
  ChatGPT, Claude and Gemini conversations the user explicitly chooses to export. If the current
  dashboard offers **User-generated content** as a separate category, select it as well.
- The extension uses this data only to create the requested local download. It does not
  retain, transmit, sell, or share conversation content. `chrome.storage.sync` contains
  only toolbar-visibility preferences and `chrome.storage.local` only the one-time
  setup-tip dismissal flag, never conversation content.
- Certify that data is not sold, used or transferred outside the single purpose, or used
  for creditworthiness or lending, and certify compliance with Chrome Web Store Limited
  Use requirements.
- **Privacy policy URL:**
  `https://raw.githubusercontent.com/kadragon/prompt-vault/main/docs/PRIVACY.md`
  — publicly reachable now, but the local policy dated 2026-08-12 will appear there only
  after this branch merges to `main`. Enter it in the dashboard only after the merge, then
  confirm the served content and file hash match the submitted policy.

## Graphic assets

| Asset | Requirement | Repository status |
|-------|-------------|-------------------|
| Store icon | 128×128 PNG | Ready: `public/icons/icon128.png` |
| Screenshots (global / English listing) | 1280×800 PNG/JPEG; 1–5 images; at least one required | Ready: `assets/store/screenshot-0{1..5}-*.png` (captured 2026-08-11 against v1.10.1; 1.10.2 changed listing copy only, no UI) |
| Screenshots (Korean listing) | same requirement, uploaded under the `ko` locale | Ready: `assets/store/ko/screenshot-0{1..5}-*.png` — the same five *views*, captured separately, so the content differs (Korean UI, Korean conversations, and a different selection count in shot 2) |
| Screenshots (`zh_CN`, `zh_TW`, `ja` listings) | same requirement, per locale | None captured. Those locales carry description copy only and fall back to the English set. A native-UI capture became possible when the catalogs shipped; it is optional, and doing it means re-running the whole five-shot sequence in that language |
| Small promotional tile | 440×280 PNG; required | Ready: `assets/store/small-promo-440x280.png`, rendered from the sibling `.svg` |
| Marquee promotional tile | 1400×560 PNG; optional | Not prepared; omit for launch |

**Per-locale assets.** The dashboard localizes the listing per language: description, screenshots
and the promotional video can each differ by locale, and a localized screenshot is shown ahead of
the global one to a viewer in that language. The **store icon, category, small promo tile and
marquee promo tile cannot be localized** — one set serves every locale, which is why the tile's
wordmark stays English. So the Korean listing can carry its own Korean-UI screenshot set without
disturbing the English one; it is optional, and until it exists the English set is what Korean
viewers see. Keep the two sets describing the same features — the store warns on localized
metadata that changes the described feature set.
([source](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), checked 2026-08-11)

Do not mock or reconstruct product screenshots. Capture the installed extension on a real,
logged-in session, then remove or obscure account details, private conversation titles,
avatars, and other personal information. The shipped set was captured with the sidebar
collapsed and every conversation created for the capture inside a throwaway
**Prompt Vault Demo** project, so no pre-existing conversation title appears in any image.
The caption band and the highlight ring around the toolbar icons are composited on top of
the unmodified capture — never edit the product pixels themselves. Keep each final image
exactly 1280×800.

Shipped screenshot set (in listing order):

1. `screenshot-01-chatgpt-toolbar` — ChatGPT conversation, MD/PDF/JSON/HTML/Bulk controls
   ringed in the conversation header.
2. `screenshot-02-project-bulk-export` — the bulk panel over a ChatGPT project home with every
   conversation selected (four in the English capture, five in the Korean one, which was taken
   after another demo conversation was added).
3. `screenshot-03-claude-conversation` — the same toolbar on Claude, evidence for the
   multi-provider claim. Captioned "Same buttons on Claude", not "…and Gemini": no Gemini
   pixel is in frame, and a caption must not claim more than its own image shows.
4. `screenshot-04-popup-settings` — the extension popup's format and bulk-icon toggles.
5. `screenshot-05-exported-pdf` — a real exported PDF with mixed English/Korean prose and
   code blocks, demonstrating selectable text and correctly rendered CJK glyphs. Its demo
   conversation deliberately holds Python and shell only: the first capture used a JavaScript
   answer and put both open PDF defects on display — the code font's ligature turned `=>` into
   `⇒`, and an inline-code run kept its backticks (both filed in `backlog.md`). Choosing content
   that avoids them keeps the caption true of the image, but it hides a defect that is still
   there, so **re-capture this shot from a conversation containing `=>` once those two items
   land** — that is the version worth shipping.

**Capturing in English on a Korean machine.** macOS Chrome takes its UI language from the OS —
there is no "display Chrome in this language" control in `chrome://settings/languages` — so
`chrome.i18n` resolves to `ko` and the extension's own popup and bulk panel render Korean. Two
moves cover most of the frame without touching the user's own Chrome or any account setting:

- Reorder the *capture profile's* language list so English (US) is first. That flips the
  `Accept-Language` header, which is enough for ChatGPT's UI and for Claude's page title and
  server-rendered strings on the next load.
- Temporarily copy `public/_locales/en/messages.json` over the `dist/_locales/<locale>/messages.json`
  the capture machine resolves to (`ko` here) and reload the unpacked extension. `dist/` is
  gitignored, so this never reaches a tracked file. Restore the file and reload again when
  finished. Five catalogs now ship (`en`, `ko`, `ja`, `zh_CN`, `zh_TW`), so overwrite the one
  Chrome actually selects, not `ko` by habit.

The Korean set needs none of that — it is what this machine produces untouched. Capture it
*before* switching anything, or restore both settings first: the header order, and `dist/`'s own
`ko` messages file. The two sets cover the same five views, so a change to what a view *shows* is a change to
both — but they are separate captures, and their conversation content and counts differ.

**What that does NOT cover, measured 2026-08-11:** strings Claude renders from
`navigator.language` stay Korean regardless of the header — in the shipped
`screenshot-03-claude-conversation.png` the native Share control still reads `공유`. Claude has no
UI-language setting to change either (`claude.ai/settings/general`'s only language control is
under **음성/Voice**, and it governs speech, not the interface). The remaining route is launching
the capture browser with `--lang=en-US`, which the Playwright MCP server is not configured to
pass; changing that is a user-scoped MCP config edit, so propose it rather than assuming it.
Collapse the sidebar before capturing either way — it is what keeps the conversation history and
account name out of frame, and it removes most of the Korean nav at the same time.

## Submission checklist

### Repository and package

- [x] `npm run lint && npm run typecheck && npm test` passes
- [x] Live load-unpacked checks pass for toolbar mounting, popup settings, single export,
  bulk export, Markdown, PDF, JSON, and HTML
- [x] Privacy gate confirms no outbound calls in adapter or export code
- [x] `npm run package` produces `prompt-vault-v<version>.zip`
- [x] ZIP has `manifest.json` at its root; manifest version matches `package.json`
- [x] Store icon and small promotional tile dimensions are correct

### Live capture

- [x] Use a non-sensitive demonstration conversation
- [x] Capture five real screenshots at 1280×800 (2026-08-11, extension v1.10.1 — no UI change in 1.10.2)
- [x] Inspect every image for names, email addresses, avatars, sidebar history, and private text
- [x] Confirm PDF Korean/CJK glyphs render without missing-glyph boxes

### Developer Dashboard — human-only

- [ ] Create or verify the Chrome Web Store developer account and complete registration payment
- [ ] Upload `prompt-vault-v<version>.zip`
- [ ] Paste `docs/store-listing/en.md` into the default locale and select Productivity
- [ ] Upload `public/icons/icon128.png`, the five `assets/store/screenshot-*.png` in numbered
  order, and `assets/store/small-promo-440x280.png`
- [ ] Add the `ko` locale, paste `docs/store-listing/ko.md`, and upload the five
  `assets/store/ko/screenshot-*.png` in the same order
- [ ] Add the `zh_CN`, `zh_TW` and `ja` locales, paste the matching
  `docs/store-listing/<locale>.md`, and leave their screenshots empty so the English set
  is served
- [ ] Enter the single-purpose statement and permission justifications
- [ ] Confirm the privacy-policy URL is publicly accessible, then enter it
- [ ] Complete data-use certifications so they match the declarations above
- [ ] Preview the listing, verify every field, and submit for review

## Notes

- Manifest name and description use `_locales`; Web Store listing copy is entered separately.
- `package.json` is the extension-version source of truth. The generated manifest and ZIP
  filename derive from it; bump before each resubmission.
- Update this document and `docs/PRIVACY.md` before submission if permissions, supported
  providers, storage, network behavior, or export behavior changes.
