// Escapes Markdown-significant characters in *raw source text* so that literal
// text survives export as literal text instead of turning into Markdown
// structure (a heading, a list item, a link reference). Applied ONLY to
// text-node / title content — never to the delimiters the serializers
// themselves emit (`**`, `[](…)`, `#`, `- `, `1.`) and never to code bodies,
// which carry their own fencing. Pure and deterministic (no Date/randomness),
// consistent with the DOM→Markdown and export determinism contracts.
//
// Scope is deliberately conservative — the exact set the review findings call
// out — so real HTML formatting is not over-escaped:
//   - inline anywhere: backtick, `[`, `]`
//   - leading (only when the text starts a line — `atLineStart`): `#`, `>`, `-`,
//     `*`, `+` (all three CommonMark bullet markers), and an ordered-list marker
//     `\d+.` / `\d+)` that is actually followed by whitespace or end-of-run (so a
//     decimal like `1.23` is left alone)
//
// `atLineStart` matters because inline serialization escapes each text node
// independently: a run after an inline element (`**bold** - x`) is NOT at a line
// start, so its leading `-` must not be treated as a bullet. Callers pass true
// only for text that genuinely begins a line/heading.

/** Backslash-escape Markdown-significant characters in plain source text. */
export function escapeMarkdownText(text: string, atLineStart = false): string {
  // Inline structure characters, anywhere in the run.
  let out = text.replace(/[`[\]]/g, (ch) => `\\${ch}`);
  if (atLineStart) {
    // Block markers only matter at the very start of a line (optional leading
    // whitespace tolerated). A run starts with either a block char or a digit,
    // so at most one of these two replacements fires.
    out = out.replace(/^(\s*)([#>\-*+])/, '$1\\$2');
    // Ordered-list marker: digits + `.`/`)` only form a list when followed by a
    // space or end-of-run — otherwise it is a decimal (`1.23`), not a marker.
    out = out.replace(/^(\s*)(\d+)([.)])(?=\s|$)/, '$1$2\\$3');
  }
  return out;
}
