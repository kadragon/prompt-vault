# Privacy Policy — Prompt Vault (AI Chat Backup)

_Last updated: 2026-07-18_

Prompt Vault is a browser extension that backs up your AI chat conversations to local
files (Markdown, PDF, JSON, HTML). This policy explains what the extension does and does
not do with your data.

## Summary

**Prompt Vault does not collect your conversations, and never transmits them off your
device.** All conversation processing happens locally, inside your browser. The extension
makes no network requests of its own to any server. The only data it stores is your
toolbar-icon preferences, which Chrome may synchronize across your own devices if you have
Chrome Sync enabled (see below) — no conversation content is ever synced or sent anywhere.

## What the extension accesses

- **The conversation(s) you ask it to export.** When you click a single-export button, the
  extension reads the currently open conversation from the page's DOM. If you use the
  optional bulk-export action, it reads the set of conversations you select from the
  sidebar, opening each in turn to read it. In every case the extension reads a
  conversation only in response to your action, and only to convert it into a file for you.

## What the extension does with it

- Converts the conversation into a file (Markdown / PDF / JSON / HTML) entirely within the
  browser and hands it to your browser's normal download mechanism, so the file is saved
  to your computer. The extension does not upload it anywhere.

## What the extension stores

- **Your toolbar preferences only.** Which export icons you choose to show are saved with
  Chrome's `storage.sync` API so the setting follows your Chrome profile. This contains no
  conversation content — only your on/off UI choices. Nothing else is persisted. Note that
  `storage.sync` is Chrome's own sync mechanism: if you are signed into Chrome with Sync
  enabled, Chrome (not this extension) propagates this preference across your devices via
  your Google account. The extension itself makes no network requests; it only asks Chrome
  to remember the setting.

## What the extension does NOT do

- It does **not** send your conversation content, or any file it produces, to any server,
  analytics service, or third party. The extension makes no network requests of its own.
  (The only data that may leave your device is your toolbar-icon preference, and only via
  Chrome Sync as described above — never any conversation content.)
- It does **not** track your browsing, build a profile, or use cookies or advertising
  identifiers.
- It does **not** sell or share your data with anyone.

## Permissions and why they are needed

- **`storage`** — to remember your toolbar icon preferences (see above). No conversation
  data is stored.
- **Host access to `chatgpt.com` and `chat.openai.com`** — so the export buttons can appear
  on, and read the conversation from, ChatGPT conversation pages. The extension runs on no
  other sites.

## Data retention and deletion

The extension retains nothing on any server (there is no server). The only stored data is
your local toolbar preference, which you can clear at any time by removing the extension
from Chrome. Exported files live on your own computer and are entirely under your control.

## Changes to this policy

If the extension's data practices ever change, this policy will be updated and the "Last
updated" date above revised before the change ships.

## Contact

Questions about this policy: kadragon@knue.ac.kr
