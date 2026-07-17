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
//   - leading (start of the run only): `#`, `>`, `-`, `*`, and an ordered-list
//     marker `\d+.` / `\d+)`

/** Backslash-escape Markdown-significant characters in plain source text. */
export function escapeMarkdownText(text: string): string {
  // Inline structure characters, anywhere in the run.
  let out = text.replace(/[`[\]]/g, (ch) => `\\${ch}`);
  // Leading block markers only matter at the very start of the run (optional
  // leading whitespace tolerated). A run starts with either a block char or a
  // digit, so at most one of these two replacements fires.
  out = out.replace(/^(\s*)([#>\-*])/, '$1\\$2');
  out = out.replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3');
  return out;
}
