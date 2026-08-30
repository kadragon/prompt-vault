# Store listing — 中文（简体）

Dashboard locale: **zh_CN**. Paste each field verbatim into
**Developer Dashboard → Store listing → zh_CN**. Shared fields (name, category, icon,
promotional tile) are not localizable — see [`../store-listing.md`](../store-listing.md).

**Summary** (≤132 chars)

```
把 ChatGPT、Claude、Gemini 的对话存成电脑里的 Markdown、PDF、JSON 或 HTML 文件。全程本地处理，内容不会离开浏览器。
```

**Description**

```
Prompt Vault 把你和 AI 的对话存成本地文件，不用注册账号，也不经过云端。

在 ChatGPT、Claude、Gemini 的对话页面，顶部会多出一个导出按钮。点一下，当前对话就按你选
的格式存到电脑上：

• Markdown（.md）：纯文本，保留标题和代码块，通用性好
• PDF（.pdf）：文字可以选中复制，中日韩字形和等宽代码块都显示正常
• JSON（.json）：结构化数据，方便拿去二次处理
• HTML（.html）：单个文件，用浏览器直接打开

要一次存多个对话，打开批量导出面板，勾选要导的对话，选一种格式一次导完。ChatGPT、Claude、
Gemini 的侧边栏都能用；ChatGPT 和 Claude 还能在项目的对话列表里用；Claude 另外支持完整
历史页面（claude.ai/recents）。

另外几点：
• 全程本地处理。扩展程序不发起任何网络请求，不往任何服务器发送内容，对话不出浏览器。
• 权限最小化。只在 ChatGPT（chatgpt.com）、Claude（claude.ai）、Gemini
  （gemini.google.com）上运行，只申请必需的权限。
• 读不到就报错。抓不到对话内容时直接提示出错，不会让你下到一个残缺文件。
• 图标可以自己挑。扩展程序弹窗里能逐个显示或隐藏各导出格式图标和批量导出图标。
• 扩展程序界面只有英文和韩文，跟随浏览器语言，暂时没有中文界面。

支持的站点：ChatGPT、Claude、Gemini。三个站点都能批量导出；项目导出目前只有 ChatGPT 和
Claude 支持。
```

**Screenshots:** None — a Chinese-UI capture is impossible, so leave this locale empty and the English set is served.

The extension UI ships only in English and Korean (`public/_locales` holds `en` and `ko`),
so the last bullet says so plainly rather than translating the English listing's
"follows your browser language" claim.
