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
Gemini 的侧边栏都能用；ChatGPT 和 Claude 还能在项目的对话列表里用，Gemini 则是在笔记本的
对话列表里用；Claude 另外支持完整历史页面（claude.ai/recents）。

另外几点：
• 全程本地处理。扩展程序不连接任何服务器，对话不出浏览器。
• 权限最小化。只在 ChatGPT（chatgpt.com）、Claude（claude.ai）、Gemini
  （gemini.google.com）上运行，只申请必需的权限。
• 读不到就报错。抓不到对话内容时直接提示出错，不会让你下到一个残缺文件。
• 分享前遮住联系方式。“分享副本”会另存一份 Markdown 副本，邮箱和电话号码自动遮盖，
  保存前先给你预览。自动识别可能有遗漏，请务必看一遍预览。遮盖同样只在浏览器里完成。
• 图标可以自己挑。扩展程序弹窗里能逐个显示或隐藏各导出格式、批量导出和分享副本的图标。
• 界面有中文。英文、简体中文、繁体中文、日文、韩文五种，按浏览器语言自动切换。

支持的站点：ChatGPT、Claude、Gemini。三个站点都能批量导出；整个项目一次导出则支持 ChatGPT
和 Claude 的项目，以及 Gemini 的笔记本。
```

**Screenshots:** None yet — no capture of the Simplified Chinese UI has been taken, so this
locale is left empty and the four-image English set (shots 1, 2, 4 and 5; shot 3 is excluded
from the English upload) is served. Recapture in zh_CN when convenient.

The extension UI is localized into Simplified Chinese (`public/_locales` holds `en`, `ja`,
`ko`, `zh_CN` and `zh_TW`), so the last bullet states the full locale list and the
browser-language behaviour. The screenshots are still the English-UI set — they have not
been retaken against the Chinese UI.
