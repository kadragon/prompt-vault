# Backlog

Design: `docs/design/chatgpt-conversation-backup.md`. v1 tickets below are vertical slices in
dependency order; blocked items stay invisible to `next-tasks` until their `*(blocked by: ...)*`
marker is removed by hand once the blocking ticket lands.

## Tooling & static analysis

> Goal: deepen mechanical enforcement of the golden principles (esp. #1 local-only) beyond the
> regex tripwire, and catch extension-specific and type-level defects in CI.

- [ ] [HARNESS] Add `addons-linter` (web-ext lint) as a CI step — validates the MV3 manifest and flags extension-unsafe patterns (`eval`, remote scripts, over-broad permissions). *(deferred: addons-linter is Firefox/AMO-oriented — on our Chrome-only MV3 manifest it only emits Firefox false-positives (`ADDON_ID_REQUIRED` gecko id, `gecko/data_collection_permissions`). No real Chrome value now; static analysis is covered by CodeQL + type-checked eslint + the privacy gate. Revisit if Firefox support is ever added.)*

## Next (roadmap — not v1)

- [ ] Gemini adapter (reuse core model + exporters via ConversationAdapter)
- [ ] Claude adapter (reuse core model + exporters via ConversationAdapter)
- [ ] Bulk download — live driver *(blocked by: needs logged-in session to verify)*: enumerate conversations from the ChatGPT sidebar (new centralized selectors + adapter `listConversations()`), navigate/extract each, feed the existing `bulkExport` core (`src/content/bulk-export.ts`), add a bulk-export UI trigger + summary surfacing, and add `chrome.downloads` permission / a background worker if Chrome's multi-download throttle requires it. The provider-agnostic export+orchestration core already landed; this is the live-DOM half that cannot be agent-verified.

## Someday

- [ ] Chrome Web Store submission (icons, listing, privacy policy, review)
