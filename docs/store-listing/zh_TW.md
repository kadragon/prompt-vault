# Store listing — 中文（繁體）

Dashboard locale: **zh_TW**. Paste each field verbatim into
**Developer Dashboard → Store listing → zh_TW**. Shared fields (name, category, icon,
promotional tile) are not localizable — see [`../store-listing.md`](../store-listing.md).

**Summary** (≤132 chars)

```
把 ChatGPT、Claude、Gemini 的對話存成電腦裡的 Markdown、PDF、JSON 或 HTML 檔案。全程在本機處理，內容不會離開瀏覽器。
```

**Description**

```
Prompt Vault 把你和 AI 的對話存成電腦裡的檔案，自己留一份，想帶去哪都行 —— 不用註冊帳號，
不經過雲端，內容也不會離開瀏覽器。

在 ChatGPT、Claude 或 Gemini 的對話頁面，上方會多一個匯出按鈕。按一下，目前這則對話就用你
選的格式存進電腦：

• Markdown (.md) — 純文字，標題和程式碼區塊都留著，檔案小，到哪都能用
• PDF (.pdf) — 文字可以選取複製，中日韓字形和等寬程式碼區塊都正常
• JSON (.json) — 結構化資料，之後還能讀回來接著用
• HTML (.html) — 單一檔案，用任何瀏覽器都能直接開啟

一次要帶走很多則對話，就開批次匯出面板，勾好要的，用同一種格式一次存完。ChatGPT、Claude、
Gemini 都可以從側邊欄開；ChatGPT 和 Claude 還能從專案的對話清單開；Claude 多了一個完整紀錄
頁（claude.ai/recents）。

幾件值得一提的事：
• 全程在本機處理。擴充功能不發任何網路請求，也不把內容送到任何伺服器，對話不會離開瀏覽器。
• 權限只拿必要的。只在 ChatGPT (chatgpt.com)、Claude (claude.ai)、Gemini
  (gemini.google.com) 上運作。
• 讀不到就報錯。抓不到對話內容時會直接顯示錯誤，不會丟給你一個殘缺的檔案。
• 圖示自己挑。擴充功能的彈出視窗裡，各種匯出格式的圖示和批次匯出圖示都能分別顯示或隱藏。
• 介面目前只有英文和韓文，會跟著瀏覽器語言走（還沒有中文介面）。

支援的網站是 ChatGPT、Claude、Gemini。三個都能批次匯出，專案匯出目前只有 ChatGPT 和
Claude 可以。
```

**Screenshots:** None — a Chinese-UI capture is impossible, so leave this locale empty and the English set is served.

The extension UI ships only in English and Korean (`public/_locales` holds `en` and `ko`),
so the last bullet says so plainly rather than translating the English listing's
"follows your browser language" claim.
