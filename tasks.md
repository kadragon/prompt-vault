# Tasks

## Review Backlog

### PR #51 — Close three Claude extraction gaps measured on 2026-07-29 (2026-07-29)

- [ ] [debt] `readSnapshot` never scans rows for attachments, so the one-shot fallback — taken
      live when there is no scroll container or it has zero height (a background tab) — drops an
      attachment-only turn entirely and omits a mixed turn's file. Pre-existing rather than
      introduced here (the shape-A path had the same hole since PR #35), but PR #51 makes the
      asymmetry sharper by adding a second tile shape that also stops at the walk. Note the
      failure is SILENT on this path: a row with no turn node is not in `nodes`, so the
      `messages.length < nodes.length` check cannot see it (AGENTS.md #4).
      (source: codex) — src/adapters/claude/index.ts:137
- [ ] [debt] The row scan can now merge the same `data-index` twice if a recycling virtualizer
      ever renders two rows carrying it in one round (`claimed.parts.unshift(files)` runs per row
      element, not per index), yielding a duplicated `[File: x]` marker. Whether Claude's
      virtualizer passes through that state is unmeasured, which is why this was not applied —
      making the scan idempotent per index is cheap if it ever shows up.
      (source: review) — src/adapters/claude/index.ts:290
