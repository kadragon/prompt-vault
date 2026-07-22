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
| **Summary** (≤132 chars) | Back up your ChatGPT conversations to local Markdown, PDF, JSON, or HTML files. 100% local — nothing leaves your browser. |

### Description (English)

```
Prompt Vault saves your AI chat conversations as local files so you own a durable,
portable copy — no account, no cloud, no data leaving your browser.

On a ChatGPT conversation page, export buttons appear in the header. One click saves the
open conversation to your computer in the format you choose:

• Markdown (.md) — clean, portable text with headings and code blocks preserved
• PDF (.pdf) — selectable text, with Korean/CJK glyphs and monospace code blocks
• JSON (.json) — structured, round-trippable data
• HTML (.html) — a self-contained document you can open in any browser

Need more than one conversation? Enable the bulk-export button, choose conversations from
the sidebar, and export the selected set in one format.

Key points:
• 100% local. The extension makes no network requests and sends nothing to any server.
  Your conversations never leave your browser.
• Least privilege. It runs only on ChatGPT (chatgpt.com / chat.openai.com) and requests
  only the minimum permissions needed.
• Choose your toolbar. The extension popup lets you show or hide each export format icon
  and the bulk-export icon.
• English and Korean UI follows your browser language.

ChatGPT is the currently supported provider.
```

### Description (Korean, optional listing)

```
Prompt Vault는 AI 채팅 대화를 로컬 파일로 저장해 계정이나 클라우드 없이 영구 사본을
보관하게 해 줍니다. 대화 데이터는 브라우저 밖으로 전송되지 않습니다.

ChatGPT 대화 페이지 헤더에 내보내기 버튼이 나타납니다. 클릭 한 번으로 현재 대화를
원하는 형식으로 컴퓨터에 저장합니다.

• Markdown (.md) — 제목과 코드 블록이 보존된 이식성 좋은 텍스트
• PDF (.pdf) — 선택 가능한 텍스트, 한글/CJK 글꼴과 고정폭 코드 블록 지원
• JSON (.json) — 구조화된 왕복 변환용 데이터
• HTML (.html) — 어떤 브라우저에서도 열 수 있는 자체 완결 문서

여러 대화가 필요하면 일괄 내보내기 버튼을 활성화하고 사이드바에서 대화를 선택해 한
형식으로 저장할 수 있습니다.

핵심:
• 100% 로컬. 확장 프로그램 자체는 네트워크 요청을 하지 않으며 어떤 서버로도 대화를
  보내지 않습니다.
• 최소 권한. ChatGPT(chatgpt.com / chat.openai.com)에서만 동작합니다.
• 툴바 선택. 확장 프로그램 팝업에서 형식별 아이콘과 일괄 내보내기 아이콘을 표시하거나
  숨길 수 있습니다.
• 브라우저 언어에 따라 영어 또는 한국어 UI를 표시합니다.

현재 지원하는 서비스는 ChatGPT입니다.
```

### Single-purpose statement (Privacy tab)

```
Prompt Vault has one purpose: to export the user's own ChatGPT conversations to local
Markdown, PDF, JSON, or HTML files. The user exports the open conversation or selects a
set of sidebar conversations through the optional bulk action. The extension reads
conversation content only in response to that user action and only to create local
downloads.
```

## Privacy and permission declarations

Use these explanations in **Dashboard → Privacy**. Re-check them whenever permissions or
data handling change.

| Permission / practice | Justification |
|-----------------------|---------------|
| `storage` | Persists toolbar and bulk-export visibility preferences through `chrome.storage.sync`. No conversation content is stored. |
| Host access `https://chatgpt.com/*`, `https://chat.openai.com/*` | Injects export controls into ChatGPT and reads conversations selected by the user for local export. These are the only sites on which the extension runs. |
| Remote code | Not used. All executable code and the PDF font are bundled in the extension package. |
| Conversation content | Processed locally only after an export action; not retained by the extension or transmitted to the developer or a third party. |

Data-use declarations:

- **Does this item collect or use user data?** Yes. Chrome's policy treats reading or
  processing website content as handling user data even when everything stays on the
  user's device.
- Select **Website content** and **Personal communications**: the extension reads the
  ChatGPT conversations the user explicitly chooses to export. If the current dashboard
  offers **User-generated content** as a separate category, select it as well.
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
| Screenshots | 1280×800 PNG/JPEG; 1–5 images; at least one required | Ready: `assets/store/screenshot-{01-chatgpt-toolbar,02-settings,03-exported-pdf}.png` |
| Small promotional tile | 440×280 PNG; required | Ready: `assets/store/small-promo-440x280.png` |
| Marquee promotional tile | 1400×560 PNG; optional | Not prepared; omit for launch |

Do not mock or reconstruct product screenshots. Capture the installed extension on a real,
logged-in ChatGPT session, then remove or obscure account details, private conversation
titles, avatars, and other personal information. Keep each final image exactly 1280×800.

Recommended screenshot set:

1. Sanitized ChatGPT conversation with MD, PDF, JSON, HTML, and Bulk controls visible in
   the conversation header.
2. Extension popup showing format visibility and bulk-export settings.
3. Exported PDF containing non-sensitive English/Korean text and a code block, demonstrating
   selectable text and correctly rendered CJK glyphs.

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
- [x] Capture three real screenshots at 1280×800
- [x] Inspect every image for names, email addresses, avatars, sidebar history, and private text
- [x] Confirm PDF Korean/CJK glyphs render without missing-glyph boxes

### Developer Dashboard — human-only

- [ ] Create or verify the Chrome Web Store developer account and complete registration payment
- [ ] Upload `prompt-vault-v<version>.zip`
- [ ] Paste the listing fields and select Productivity
- [ ] Upload `public/icons/icon128.png`, 1–5 screenshots, and
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
