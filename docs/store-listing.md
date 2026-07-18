# Chrome Web Store — Listing & Submission

Everything needed to fill the Chrome Web Store Developer Dashboard for **Prompt Vault**.
Copy the fields below verbatim; items marked **[you decide]** need a human choice, and items
marked **[human-only]** cannot be produced by an agent (need a logged-in browser or a
dashboard account).

## Store listing fields

| Field | Value |
|-------|-------|
| **Name** | Prompt Vault — AI Chat Backup |
| **Category** | Productivity |
| **Language** | English (default); Korean listing optional |
| **Summary** (≤132 chars) | Back up your ChatGPT conversations to local Markdown, PDF, JSON, or HTML files. 100% local — nothing leaves your browser. |

### Description (long)

```
Prompt Vault saves your AI chat conversations as local files so you own a durable,
portable copy — no account, no cloud, no data leaving your browser.

On a ChatGPT conversation page, export buttons appear in the header. One click saves the
whole conversation to your computer in the format you choose:

• Markdown (.md) — clean, portable text with headings and code blocks preserved
• PDF (.pdf) — selectable text, with Korean/CJK glyphs and monospace code blocks
• JSON (.json) — structured, round-trippable data
• HTML (.html) — a self-contained document you can open in any browser

Key points:
• 100% local. The extension makes no network requests and sends nothing to any server.
  Your conversations never leave your browser.
• Least privilege. It runs only on ChatGPT (chatgpt.com / chat.openai.com) and requests
  only the minimum permissions needed.
• Choose your toolbar. A settings page lets you show or hide each export format icon.
• Korean & English UI, following your browser language.

First target is ChatGPT; Gemini and Claude support are planned.
```

### Description (Korean, optional listing)

```
Prompt Vault는 AI 채팅 대화를 로컬 파일로 저장해, 계정·클라우드 없이 브라우저 밖으로
데이터를 내보내지 않고도 대화의 영구 사본을 보관하게 해 줍니다.

ChatGPT 대화 페이지 헤더에 내보내기 버튼이 나타납니다. 클릭 한 번으로 전체 대화를
원하는 형식으로 컴퓨터에 저장합니다:

• Markdown (.md) — 제목과 코드 블록이 보존된 이식성 좋은 텍스트
• PDF (.pdf) — 선택 가능한 텍스트, 한글/CJK 글꼴과 고정폭 코드 블록 지원
• JSON (.json) — 구조화된, 왕복 변환 가능한 데이터
• HTML (.html) — 어떤 브라우저에서도 열 수 있는 자체 완결 문서

핵심:
• 100% 로컬. 네트워크 요청이 전혀 없으며 어떤 서버로도 데이터를 보내지 않습니다.
• 최소 권한. ChatGPT(chatgpt.com / chat.openai.com)에서만 동작하며 필요한 최소 권한만
  요청합니다.
• 툴바 선택. 설정 페이지에서 형식별 아이콘 표시 여부를 고를 수 있습니다.
• 한국어·영어 UI, 브라우저 언어를 따릅니다.

첫 지원 대상은 ChatGPT이며, Gemini와 Claude 지원을 계획하고 있습니다.
```

### Single-purpose statement (required by review)

```
Prompt Vault has one purpose: to export the user's own conversations from a supported AI
chat site to local files (Markdown, PDF, JSON, or HTML) that the user downloads to their
own device. The user exports either the conversation currently open, or — via the optional
bulk action — a set of conversations they select from the sidebar; in both cases the
extension only reads a conversation in response to the user's action and only to produce
the download.
```

## Privacy & permission justifications (Dashboard → Privacy tab)

Chrome requires a written justification per permission. Use these:

| Permission | Justification |
|------------|---------------|
| `storage` | Persists the user's toolbar-icon preferences (which export formats to show) via `chrome.storage.sync`. Stores no conversation content. |
| Host access `https://chatgpt.com/*`, `https://chat.openai.com/*` | The extension injects the export buttons into, and reads the open conversation from, ChatGPT conversation pages. These are the only sites it operates on. |
| Remote code | **Not used.** All code is bundled in the package; the extension loads no remote scripts. |

### Data-use disclosures (the checkboxes)

- Does this item collect or use user data? **No.**
- All of "sold to third parties", "used/transferred for purposes unrelated to the item's
  core functionality", "used/transferred to determine creditworthiness / for lending" →
  **certify all three as false.**
- **Privacy policy URL:** **[you decide]** — host `docs/PRIVACY.md` at a public URL (e.g.
  GitHub Pages / a repo raw link / gist) and paste it here. Required because the store
  mandates a privacy policy for every listing.

## Graphic assets

| Asset | Spec | Status |
|-------|------|--------|
| Store icon | 128×128 PNG | ✅ ships as `public/icons/icon128.png` |
| Screenshots | 1280×800 **or** 640×400 PNG/JPEG, 1–5 images, at least one required | **[human-only]** — capture on a live logged-in ChatGPT conversation showing the header export buttons + a saved file; needs a login session an agent cannot drive |
| Small promo tile | 440×280 PNG (optional) | **[you decide]** — optional; skip for launch |
| Marquee promo | 1400×560 PNG (optional) | **[you decide]** — optional; skip for launch |

Screenshot shot list (suggested):
1. ChatGPT conversation with the MD/PDF/JSON/HTML buttons visible in the header.
2. The settings popup (toolbar-icon chooser).
3. An exported PDF open, showing selectable text + a code block (Korean example ideal).

## Submission checklist

Build & package (agent-doable):
- [ ] `npm run lint && npm run typecheck && npm test` all green
- [ ] `npm run package` → produces `prompt-vault-v<version>.zip` (runs `vite build` first)
- [ ] Confirm the zip has `manifest.json` at its root and the version matches `package.json`

Dashboard (human-only — needs a Web Store developer account, one-time $5 fee):
- [ ] Create/verify the developer account
- [ ] Upload `prompt-vault-v<version>.zip`
- [ ] Paste name, summary, description, category from above
- [ ] Add ≥1 screenshot (see shot list)
- [ ] Fill permission justifications + single-purpose statement
- [ ] Set the privacy policy URL and certify the data-use disclosures
- [ ] Submit for review

## Notes

- The manifest name/description are localized via `_locales`, so Chrome shows the localized
  display name automatically; the **listing** text above is separate and entered by hand in
  the dashboard.
- Keep `version` in `package.json` as the single source of truth — the manifest and the zip
  filename both derive from it. Bump it before every re-submission.
