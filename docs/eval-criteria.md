# Evaluation Criteria

The evaluator (`product-evaluator`) is a **separate role** from the generator. Whoever wrote the code
never grades it — this separation is the single most impactful quality decision.

## Criteria (browser-extension export tool)

### 1. Extraction fidelity (weight: 35%)

Does the exported file faithfully reproduce the conversation?

| Score | Description |
|-------|-------------|
| 5 | All messages, both roles, in order; code blocks, lists, and formatting preserved |
| 3 | All messages present; some rich formatting (code/tables) degraded but readable |
| 1 | Missing messages, wrong order, or empty/garbled output |

**How to test:** open a real conversation, export, diff against the on-screen content.

### 2. Privacy / local-only (weight: 25%)

No conversation data leaves the browser.

| Score | Description |
|-------|-------------|
| 5 | Zero external network calls in adapter/export/content paths; permissions minimal & justified |
| 3 | Local-only but requests a broader permission than needed |
| 1 | Any outbound call with conversation data, or `<all_urls>`-style over-permissioning |

**How to test:** grep the changed code for `fetch`/`XHR`/`sendBeacon`; watch DevTools Network during export.

### 3. Robustness / fail-loud (weight: 20%)

Handles long, virtualized, or partially-rendered conversations without silent failure.

| Score | Description |
|-------|-------------|
| 5 | Captures full history; on extraction failure shows a clear visible error |
| 3 | Works on typical conversations; degrades gracefully with a message on edge cases |
| 1 | Produces a silent empty/truncated download, or throws to console with no user feedback |

**How to test:** export a very long conversation and a fresh/near-empty one; force a selector miss.

### 4. UX & format quality (weight: 20%)

The button and the output are clean and usable.

| Score | Description |
|-------|-------------|
| 5 | Button unobtrusive top-right; md is valid & readable, pdf is well laid out; sane filename |
| 3 | Works, minor layout/spacing issues |
| 1 | Button breaks the page layout, or output is malformed |

**How to test:** load-unpacked, click the button, open both exports.

## Pass threshold

- Every criterion ≥ 3 (no dimension broken), AND
- Weighted average ≥ 3.5.

A failed Sprint Contract item fails the feature regardless of other scores — do not average away a
real defect.

## Sprint Contract (pre-implementation agreement)

Written into `tasks.md` before coding. One contract active at a time.

```markdown
# {Feature title}
status: active

## Scope
{specific what-I-will-build}

## Acceptance criteria
- [ ] {concrete, testable}
- [ ] {concrete, testable}

## Out of scope
{explicit exclusions}

## Lint/test command
{exact command, e.g. `npm run build && npm run lint`}
```

## Evaluator protocol

1. Read the Sprint Contract / `Done-when` criteria.
2. Read this file for standards.
3. Exercise the feature for real (load-unpacked + a live export), not by reading code alone.
4. List specific pass/fail evidence per criterion **before** assigning a score.
5. Below threshold → findings become `backlog.md`/`tasks.md` items → fix → re-evaluate.

Be skeptical by default: hunt for what's broken (missing messages, a stray network call), not what works.
