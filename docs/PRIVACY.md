# Privacy Policy — Prompt Vault (AI Chat Backup)

_Last updated: 2026-07-18_

Prompt Vault is a browser extension that backs up your AI chat conversations to local
files (Markdown, PDF, JSON, HTML). This policy explains what the extension does and does
not do with your data.

## Summary

**Prompt Vault does not collect, transmit, store, or share any of your data.** All
processing happens locally, inside your browser. Your conversations never leave your
device.

## What the extension accesses

- **The conversation on the page you are viewing.** When you click an export button, the
  extension reads the currently open conversation from the page's DOM in order to convert
  it into the file format you chose. This reading happens only in response to your click
  and only for the conversation you are looking at.

## What the extension does with it

- Converts the conversation into a file (Markdown / PDF / JSON / HTML) entirely within the
  browser and hands it to your browser's normal download mechanism, so the file is saved
  to your computer. The extension does not upload it anywhere.

## What the extension stores

- **Your toolbar preferences only.** Which export icons you choose to show are saved with
  Chrome's `storage.sync` API so the setting follows your Chrome profile. This contains no
  conversation content — only your on/off UI choices. Nothing else is persisted.

## What the extension does NOT do

- It does **not** send conversation content, or any other data, to any server, analytics
  service, or third party. The extension makes no network requests to external hosts.
- It does **not** track your browsing, build a profile, or use cookies or advertising
  identifiers.
- It does **not** sell or share data with anyone — there is no data to sell or share.

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
