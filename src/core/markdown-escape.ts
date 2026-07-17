// Escapes Markdown-significant characters in *raw source text* so that literal
// text survives export as literal text instead of turning into Markdown
// structure (a heading, a list item, a link reference, emphasis). Applied ONLY
// to text-node / title content — never to the delimiters the serializers
// themselves emit (`**`, `[](…)`, `#`, `- `, `1.`) and never to code bodies,
// which carry their own fencing. Pure and deterministic (no Date/randomness),
// consistent with the DOM→Markdown and export determinism contracts.
//
// Scope:
//   - inline anywhere: backslash (escaped FIRST so the backslashes added below
//     are not themselves re-doubled), backtick, `[`, `]`
//   - emphasis/strikethrough runs `*`, `_`, `~` — escaped per CommonMark
//     *flanking* rules so real formatting is preserved while `snake_case` (an
//     intraword `_`) and non-flanking delimiters are left alone. `*`/`~` runs
//     escape when left- OR right-flanking; `_` uses the stricter intraword rule.
//     Trade-off (flanking-only, no delimiter pairing): a lone `*` in a glob
//     (`*.txt`) is escaped to `\*.txt` — renders identically, just an extra
//     backslash in source.
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
  let out = escapeInline(text);
  if (atLineStart) {
    // Block markers only matter at the very start of a line (optional leading
    // whitespace tolerated). A leading `*` that was already escaped by the inline
    // pass now begins with `\`, so these regexes cannot double-escape it.
    out = out.replace(/^(\s*)([#>\-*+])/, '$1\\$2');
    // Ordered-list marker: digits + `.`/`)` only form a list when followed by a
    // space or end-of-run — otherwise it is a decimal (`1.23`), not a marker.
    out = out.replace(/^(\s*)(\d+)([.)])(?=\s|$)/, '$1$2\\$3');
  }
  return out;
}

// Single left-to-right scan over the ORIGINAL text so the backslashes we add
// never perturb the neighbor lookups used for flanking classification. Escapes
// `\`, `` ` ``, `[`, `]` unconditionally and `*`/`_`/`~` runs when flanking.
function escapeInline(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' || ch === '`' || ch === '[' || ch === ']') {
      out += `\\${ch}`;
      i++;
      continue;
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      // Consume the whole run of this delimiter and classify it as a unit.
      let j = i + 1;
      while (j < text.length && text[j] === ch) j++;
      const before = i > 0 ? text[i - 1] : ' ';
      const after = j < text.length ? text[j] : ' ';
      const piece = shouldEscapeDelimiter(ch, before, after) ? `\\${ch}` : ch;
      out += piece.repeat(j - i);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// Decide whether a `*`/`_`/`~` delimiter run is emphasis-capable in its context
// (CommonMark 6.2). Start/end of string are passed in as a space, so they read
// as whitespace neighbors.
function shouldEscapeDelimiter(ch: string, before: string, after: string): boolean {
  const leftFlanking =
    !isWhitespace(after) &&
    (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
  const rightFlanking =
    !isWhitespace(before) &&
    (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
  if (ch === '_') {
    // An intraword `_` (both neighbors word chars → flanking both sides without a
    // punctuation neighbor) can neither open nor close, so `snake_case` is safe.
    const canOpen = leftFlanking && (!rightFlanking || isPunctuation(before));
    const canClose = rightFlanking && (!leftFlanking || isPunctuation(after));
    return canOpen || canClose;
  }
  return leftFlanking || rightFlanking;
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

// ASCII punctuation per CommonMark's definition. (The category also includes
// Unicode punctuation, but the assistant text this escaper handles is ASCII in
// practice; broadening later is additive and would only escape more, never less.)
function isPunctuation(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (
    (c >= 0x21 && c <= 0x2f) || // ! " # $ % & ' ( ) * + , - . /
    (c >= 0x3a && c <= 0x40) || // : ; < = > ? @
    (c >= 0x5b && c <= 0x60) || // [ \ ] ^ _ `
    (c >= 0x7b && c <= 0x7e) //    { | } ~
  );
}
