# Chrome Web Store — Listing & Submission

Dashboard-ready copy and asset checklist for **Prompt Vault**. Copy fields below verbatim.
Items marked **[human-only]** require a logged-in ChatGPT session or Chrome Web Store
Developer Dashboard access.

## Store listing fields

| Field | Value |
|-------|-------|
| **Name** | Prompt Vault — AI Chat Backup |
| **Category** | Productivity |
| **Language** | English (default); Korean listing optional |
| **Summary** (≤132 chars) | Back up ChatGPT, Claude & Gemini chats to local Markdown, PDF, JSON, or HTML files. 100% local — nothing leaves your browser. |

### Description (English)

```
Prompt Vault saves your AI chat conversations as local files so you own a durable,
portable copy — no account, no cloud, no data leaving your browser.

On a ChatGPT, Claude, or Gemini conversation page, export buttons appear in the header. One
click saves the open conversation to your computer in the format you choose:

• Markdown (.md) — clean, portable text with headings and code blocks preserved
• PDF (.pdf) — selectable text, with Korean/CJK glyphs and monospace code blocks
• JSON (.json) — structured, round-trippable data
• HTML (.html) — a self-contained document you can open in any browser

Need more than one conversation? Open the bulk-export panel, tick the conversations you
want, and save the whole set in one format and one run. On ChatGPT and Claude you can do
this from the sidebar, from a project's conversation list, or — on Claude — from the full
history page at claude.ai/recents.

Key points:
• 100% local. The extension makes no network requests and sends nothing to any server.
  Your conversations never leave your browser.
• Least privilege. It runs only on ChatGPT (chatgpt.com), Claude (claude.ai) and
  Gemini (gemini.google.com), and requests only the minimum permissions needed.
• Nothing silently truncated. If a conversation or a conversation list cannot be read in
  full, the extension tells you instead of saving a short file.
• Choose your toolbar. The extension popup lets you show or hide each export format icon
  and the bulk-export icon.
• English and Korean UI follows your browser language.

Supported providers: ChatGPT, Claude and Gemini. Bulk export is available on ChatGPT and
Claude; Gemini supports single-conversation export.
```

### Description (Korean, optional listing)

```
Prompt Vault는 AI 채팅 대화를 로컬 파일로 저장해 계정이나 클라우드 없이 영구 사본을
보관하게 해 줍니다. 대화 데이터는 브라우저 밖으로 전송되지 않습니다.

ChatGPT, Claude, Gemini 대화 페이지 헤더에 내보내기 버튼이 나타납니다. 클릭 한 번으로
현재 대화를 원하는 형식으로 컴퓨터에 저장합니다.

• Markdown (.md) — 제목과 코드 블록이 보존된 이식성 좋은 텍스트
• PDF (.pdf) — 선택 가능한 텍스트, 한글/CJK 글꼴과 고정폭 코드 블록 지원
• JSON (.json) — 구조화된 왕복 변환용 데이터
• HTML (.html) — 어떤 브라우저에서도 열 수 있는 자체 완결 문서

여러 대화를 한 번에 저장하려면 일괄 내보내기 패널을 열고 원하는 대화를 선택한 뒤 한
형식으로 내려받으면 됩니다. ChatGPT와 Claude에서는 사이드바와 프로젝트 대화 목록에서,
Claude에서는 전체 기록 페이지(claude.ai/recents)에서도 사용할 수 있습니다.

핵심:
• 100% 로컬. 확장 프로그램 자체는 네트워크 요청을 하지 않으며 어떤 서버로도 대화를
  보내지 않습니다.
• 최소 권한. ChatGPT(chatgpt.com), Claude(claude.ai), Gemini(gemini.google.com)에서만
  동작합니다.
• 잘린 저장 없음. 대화나 대화 목록을 끝까지 읽지 못하면 짧은 파일을 만드는 대신 오류를
  표시합니다.
• 툴바 선택. 확장 프로그램 팝업에서 형식별 아이콘과 일괄 내보내기 아이콘을 표시하거나
  숨길 수 있습니다.
• 브라우저 언어에 따라 영어 또는 한국어 UI를 표시합니다.

현재 지원하는 서비스는 ChatGPT, Claude, Gemini입니다. 일괄 내보내기는 ChatGPT와 Claude에서
제공되며, Gemini는 단일 대화 내보내기를 지원합니다.
```

### Single-purpose statement (Privacy tab)

```
Prompt Vault has one purpose: to export the user's own AI chat conversations to local
Markdown, PDF, JSON, or HTML files. It supports ChatGPT, Claude and Gemini. The user exports the
open conversation or, on ChatGPT and Claude, selects a set of conversations from the
sidebar, a project list, or the history page through the optional bulk action. The
extension reads conversation content only in response to that user action and only to
create local downloads.
```

## Privacy and permission declarations

Use these explanations in **Dashboard → Privacy**. Re-check them whenever permissions or
data handling change.

| Permission / practice | Justification |
|-----------------------|---------------|
| `storage` | Persists toolbar and bulk-export visibility preferences through `chrome.storage.sync`. No conversation content is stored. |
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
  only toolbar-visibility preferences, never conversation content.
- Certify that data is not sold, used or transferred outside the single purpose, or used
  for creditworthiness or lending, and certify compliance with Chrome Web Store Limited
  Use requirements.
- **Privacy policy URL:**
  `https://raw.githubusercontent.com/kadragon/prompt-vault/main/docs/PRIVACY.md`
  — publicly reachable now, but the local policy dated 2026-07-22 will appear there only
  after this branch merges to `main`. Enter it in the dashboard only after the merge, then
  confirm the served content and file hash match the submitted policy.

## Graphic assets

| Asset | Requirement | Repository status |
|-------|-------------|-------------------|
| Store icon | 128×128 PNG | Ready: `public/icons/icon128.png` |
| Screenshots | 1280×800 PNG/JPEG; 1–5 images; at least one required | Ready: `assets/store/screenshot-0{1..5}-*.png` (captured 2026-08-11 against v1.10.1; 1.10.2 changed listing copy only, no UI) |
| Small promotional tile | 440×280 PNG; required | Ready: `assets/store/small-promo-440x280.png`, rendered from the sibling `.svg` |
| Marquee promotional tile | 1400×560 PNG; optional | Not prepared; omit for launch |

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
2. `screenshot-02-project-bulk-export` — the bulk panel over a ChatGPT project home with all
   four conversations selected.
3. `screenshot-03-claude-conversation` — the same toolbar on Claude, evidence for the
   multi-provider claim. Captioned "Same buttons on Claude", not "…and Gemini": no Gemini
   pixel is in frame, and a caption must not claim more than its own image shows.
4. `screenshot-04-popup-settings` — the extension popup's format and bulk-icon toggles.
5. `screenshot-05-exported-pdf` — a real exported PDF with mixed English/Korean prose and
   code blocks, demonstrating selectable text and correctly rendered CJK glyphs.

**Capturing in English on a Korean machine.** macOS Chrome takes its UI language from the OS —
there is no "display Chrome in this language" control in `chrome://settings/languages` — so
`chrome.i18n` resolves to `ko` and the extension's own popup and bulk panel render Korean. Two
moves cover most of the frame without touching the user's own Chrome or any account setting:

- Reorder the *capture profile's* language list so English (US) is first. That flips the
  `Accept-Language` header, which is enough for ChatGPT's UI and for Claude's page title and
  server-rendered strings on the next load.
- Temporarily copy `public/_locales/en/messages.json` over `dist/_locales/ko/messages.json` and
  reload the unpacked extension. `dist/` is gitignored, so this never reaches a tracked file.
  Restore the file and reload again when finished.

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
- [ ] Paste the listing fields and select Productivity
- [ ] Upload `public/icons/icon128.png`, the five screenshots in numbered order, and
  `assets/store/small-promo-440x280.png`
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
