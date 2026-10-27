// Share copy: turns a Conversation into a separate copy meant for handing to someone
// else, with detected emails/phone numbers and user-supplied terms masked
// (docs/design/share-copy-export.md). Pure, DOM-free and provider-agnostic — it maps
// a Conversation to a Conversation, so it sits beside the model, not in src/export/.
// Detection is best-effort; the caller's review step owns completeness, so nothing
// here may claim the result is anonymized.

import type { Conversation, Message } from './conversation';

export type ShareCandidateKind = 'email' | 'phone';

/** A detected value in one message's `content`, as a half-open `[start, end)` span. */
export interface ShareCandidate {
  kind: ShareCandidateKind;
  text: string;
  messageIndex: number;
  start: number;
  end: number;
}

/** Identifies a candidate the user unchecked. */
export type ShareCandidateRef = Pick<ShareCandidate, 'messageIndex' | 'start' | 'end'>;

export interface ShareCopyOptions {
  /** Candidates to leave as-is (false positives the user unchecked). */
  excluded: readonly ShareCandidateRef[];
  /** Literal terms to mask, matched case-insensitively. Blank terms are ignored. */
  manualTerms: readonly string[];
  /** Replaces the original title wholesale; passed in because core cannot call chrome.i18n. */
  neutralTitle: string;
}

const TOKEN: Record<ShareCandidateKind | 'term', string> = {
  email: '[EMAIL]',
  phone: '[PHONE]',
  term: '[REDACTED]',
};

// The common `local@domain.tld` shape. Domain labels are dot-separated so a
// sentence-ending period is never swallowed into the match. The local part has to
// read two spellings of the same address, because content is adapter Markdown:
//   - prose is escaped by escapeMarkdownText (src/core/markdown-escape.ts), so
//     `john_@x.io` arrives as `john\_@x.io` — the local part takes those backslash
//     escapes, or `john` would be left unmasked in front of the token;
//   - code keeps its text raw, so `x*y@x.io` arrives as-is — the local part takes a
//     raw run of `* ~ | ' \`` too, but only between local-part characters, so the
//     delimiters around `**a@x.io**`, `~~a@x.io~~` or inline code stay outside the
//     match and still render. Any other backslash before a local-part character
//     (`a\qb@x.io`, raw text) is taken too; one before `[` is not, so the escaped
//     brackets of `\[a@x.io\]` stay balanced.
// A match never starts right after an odd run of backslashes: that backslash is the second
// half of an escaped `\\` pair (`C:\\Users\\kim@x.io`), and taking it would drop a
// backslash from the rendered text.
// Local-part characters include Latin-1 and Latin Extended letters (`Renée@x.io`), but
// not Hangul or CJK: those touch the address without a space (`메일은a@x.io`), and
// swallowing them would mask the surrounding sentence.
// The leading lookahead only lets a match start where an `@` follows within 128
// non-space characters (an RFC local part is at most 64; escapes can double it). Without
// it a long `@`-less run — a base64 blob, minified code, `a*a*a*…` — was rescanned from
// every offset to its end: quadratic, seconds per call on a 40k-char token, and the
// review modal recomputes on every change. A left-boundary lookbehind was tried first
// and dropped: it missed the second of two touching addresses (`a@x.com.b@y.com`) and
// left runs broken by `* ' \` quadratic.
const LOCAL_CHARS = String.raw`A-Za-z0-9._%+\-\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F`;
const LOCAL_ATOM = String.raw`(?:[${LOCAL_CHARS}]|\\[${LOCAL_CHARS}_*~|'\`])+`;
const EMAIL = new RegExp(
  String.raw`(?=[^\s@]{1,128}@)(?<!(?:^|[^\\])(?:\\\\)*\\)${LOCAL_ATOM}(?:[*~|'\`]+${LOCAL_ATOM})*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`,
  'g',
);

// One alternation so an international number is never reported twice (once whole,
// once as its domestic tail). A separator or a leading `+` is always required: bare
// digit runs collide with dates, ids and amounts. The digit guards on both ends stop
// a match from being carved out of a longer run or a decimal's fraction digits. A
// comma is deliberately not guarded: CSV rows (`1,010-1234-5678`) put a digit there.
//   - `+`-country-code international: `+82 10-1234-5678`, `+1 415 555 2671`, `+442071838750`
//   - Korean mobile/landline: `010-1234-5678`, `02.123.4567`, `010 1234 5678`,
//     `010-12345678`, and a parenthesized area code `(02) 123-4567`
//   - North-American `(415) 555-0123`, `415-555-0123`: the area code starts 2–9, as
//     NANP area codes do, which keeps `123-456-7890`-shaped ids out
//   - Chinese mobile `138 0013 8000`, `138-0013-8000`: 3-4-4 after a `1[3-9]` prefix
const PHONE = new RegExp(
  String.raw`(?<![\d+]|\d\.)(?:` +
    [
      String.raw`\+\d{1,3}[-. ]?\d{1,4}(?:[-. ]?\d{3,4}){1,3}`,
      String.raw`0[1-9]\d?[-. ]\d{3,4}[-. ]?\d{4}`,
      String.raw`\(0[1-9]\d?\) ?\d{3,4}[-. ]\d{4}`,
      String.raw`\([2-9]\d{2}\) ?\d{3}[-. ]\d{4}`,
      String.raw`[2-9]\d{2}[-. ]\d{3}[-. ]\d{4}`,
      String.raw`1[3-9]\d[- ]\d{4}[- ]\d{4}`,
    ].join('|') +
    String.raw`)(?!\d)`,
  'g',
);

const DETECTORS: ReadonlyArray<[ShareCandidateKind, RegExp]> = [
  ['email', EMAIL],
  ['phone', PHONE],
];

/**
 * Detect emails and phone numbers in every message's `content`, code blocks
 * included. The title is not scanned — the share copy replaces it wholesale.
 * Ordered by message, then by offset. Candidates of different kinds may overlap;
 * `createShareCopy` resolves that.
 */
export function findShareCandidates(conversation: Conversation): ShareCandidate[] {
  const candidates: ShareCandidate[] = [];
  conversation.messages.forEach((message, messageIndex) => {
    for (const [kind, pattern] of DETECTORS) {
      for (const match of message.content.matchAll(pattern)) {
        const start = match.index;
        candidates.push({ kind, text: match[0], messageIndex, start, end: start + match[0].length });
      }
    }
  });
  return candidates.sort((a, b) => a.messageIndex - b.messageIndex || a.start - b.start);
}

/**
 * Build the share copy: a new Conversation with kept candidates and manual terms
 * replaced by their tokens, the neutral title, no source url, no timestamp and no
 * message ids. The input is never mutated.
 */
export function createShareCopy(conversation: Conversation, options: ShareCopyOptions): Conversation {
  return createShareCopyWithCount(conversation, options).copy;
}

/**
 * `createShareCopy`, plus how many tokens it inserted — one per masked span after
 * overlaps merge — so the review UI can summarize the copy without re-parsing it
 * (the original text may itself contain a literal `[EMAIL]`).
 */
export function createShareCopyWithCount(
  conversation: Conversation,
  options: ShareCopyOptions,
): { copy: Conversation; masked: number } {
  const excluded = new Set(options.excluded.map(refKey));
  const termPatterns = manualTermPatterns(options.manualTerms);
  const kept = findShareCandidates(conversation).filter((c) => !excluded.has(refKey(c)));

  let masked = 0;
  const messages: Message[] = conversation.messages.map((message, messageIndex) => {
    const spans: Span[] = kept
      .filter((c) => c.messageIndex === messageIndex)
      .map((c) => ({ start: c.start, end: c.end, token: TOKEN[c.kind] }));
    for (const pattern of termPatterns) spans.push(...termSpans(message.content, pattern));
    const replaced = replaceSpans(message.content, spans);
    masked += replaced.count;
    return { role: message.role, content: replaced.text };
  });

  return { copy: { title: options.neutralTitle, provider: conversation.provider, url: '', messages }, masked };
}

interface Span {
  start: number;
  end: number;
  token: string;
}

function refKey(ref: ShareCandidateRef): string {
  return `${ref.messageIndex}:${ref.start}:${ref.end}`;
}

// One case-insensitive literal pattern per distinct non-blank term spelling. Kept
// separate, not joined into one alternation: an alternation only reports
// non-overlapping matches, so a term overlapping an earlier match (`Smith & Co` after
// `John Smith`) would never become a span and its tail would survive.
function manualTermPatterns(terms: readonly string[]): RegExp[] {
  const usable = new Set(terms.filter((t) => t.trim() !== '').flatMap(termSpellings));
  return [...usable].map((spelling) => new RegExp(termSource(spelling), 'giu'));
}

// The spellings of one term to search for. The text is never normalized — offsets must
// keep pointing into the original — so the term is expanded instead:
//   - NFC and NFD, for text that carries `é` as one code point or as `e` + U+0301;
//   - full upper-casing, which the `iu` flags' simple case folding cannot do:
//     `straße` → `STRASSE` (`ẞ` already folds to `ß` under `u`);
//   - Turkish casing, whose dotted/dotless i never fold to ASCII `i`/`I`, applied to the
//     term as typed and to its upper and lower forms so it is symmetric: `istanbul` →
//     `İSTANBUL`, `ışık` → `IŞIK`, and `KIM` → `KİM` as well as `kim` → `kım`.
function termSpellings(term: string): string[] {
  const cased = [term, term.toUpperCase(), term.toLowerCase()].flatMap((t) => [
    t,
    t.toLocaleUpperCase('tr'),
    t.toLocaleLowerCase('tr'),
  ]);
  return [...new Set(cased.flatMap((t) => [t.normalize('NFC'), t.normalize('NFD')]))];
}

// A term is typed as plain text, but content is adapter Markdown in which
// escapeMarkdownText may have put a backslash before any ASCII punctuation
// (`[Falcon]` arrives as `\[Falcon\]`, `Acme_` as `Acme\_`). Each punctuation
// character therefore also matches with that optional backslash in front.
// A term edge that is a Latin letter or digit only matches at a word boundary, so
// `Lee` masks `Lee.` but not `sleeps`. Hangul and CJK edges stay unbounded: those
// scripts attach particles without a space (`김철수님`, `田中さん`). The end edge looks
// past trailing combining marks, so the NFD spelling `Jose\u0301` is bounded like `José`
// and leaves a decomposed `Joséphine` alone.
// A whitespace run between two words of the term matches any whitespace run in the
// content, with emphasis delimiters allowed on either side: `<em>John</em> Smith` arrives
// as `*John* Smith`, and a line break or double space between the words is still the same
// name. Whitespace at the term's ends stays literal: a leading gap would have no fixed
// character to anchor on and rescan a long space run from every position in it.
function termSource(term: string): string {
  const chars = [...term];
  const first = chars.findIndex((char) => !WHITESPACE.test(char));
  const last = chars.length - 1 - [...chars].reverse().findIndex((char) => !WHITESPACE.test(char));
  let source = LATIN_WORD_CHAR.test(chars[0] ?? '') ? `(?<!${LATIN_WORD_CLASS})` : '';
  for (const [i, char] of chars.entries()) {
    if (i > first && i < last && WHITESPACE.test(char)) {
      if (!WHITESPACE.test(chars[i - 1])) source += TERM_WORD_GAP;
    } else if (TURKISH_I.has(char)) source += '[iIıİ]';
    else source += ASCII_PUNCTUATION.test(char) ? `\\\\?${escapeRegExp(char)}` : escapeRegExp(char);
  }
  const lastBase = [...chars].reverse().find((char) => !COMBINING_MARK.test(char)) ?? '';
  return LATIN_WORD_CHAR.test(lastBase) ? `${source}(?!${COMBINING_MARKS}*${LATIN_WORD_CLASS})` : source;
}

// Combining Diacritical Marks: what NFD splits off Latin letters (`é` → `e` + U+0301).
const COMBINING_MARKS = '[\\u0300-\\u036F]';
const COMBINING_MARK = new RegExp(`^${COMBINING_MARKS}$`);

const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const WHITESPACE = /^\s$/;
// Up to three `*` each side: the adapter emits `*em*`, `**strong**`, and both nested. The
// bounded counts keep a failed match linear in the whitespace run.
const TERM_WORD_GAP = '\\*{0,3}\\s+\\*{0,3}';
// The four i letters match one another per character: whole-term casing alone cannot reach a
// mixed form like `Işık` from `ışık` or `IŞIK`, and a Turkish name is often written that way.
const TURKISH_I = new Set(['i', 'I', 'ı', 'İ']);
// ASCII letters and digits plus Latin-1 Supplement and Latin Extended-A/B letters.
const LATIN_WORD_CLASS = '[A-Za-z0-9\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F]';
const LATIN_WORD_CHAR = new RegExp(`^${LATIN_WORD_CLASS}$`);

// Every occurrence of one term, overlapping ones included (`아아` twice in `아아아`):
// the scan restarts one code unit past each match start instead of past its end.
function termSpans(content: string, pattern: RegExp): Span[] {
  const spans: Span[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
    spans.push({ start: match.index, end: match.index + match[0].length, token: TOKEN.term });
    // Step one code point, not one code unit: under the `u` flag a lastIndex inside a
    // surrogate pair snaps back to the pair's start, so `+ 1` on a match that starts with an
    // emoji or `𠮷` would rematch the same spot forever.
    pattern.lastIndex = match.index + (content.codePointAt(match.index)! > 0xffff ? 2 : 1);
  }
  return spans;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Single pass over the ORIGINAL text: every span was matched against `content`
// before any replacement, so a term like `email` can never hit an inserted
// `[EMAIL]` and nest tokens. Overlapping spans collapse into one token — the
// earliest start wins, then the longer span — covering the union of the overlap,
// so a later span is never left with an unmasked tail.
function replaceSpans(content: string, spans: Span[]): { text: string; count: number } {
  const merged: Span[] = [];
  for (const span of [...spans].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = merged.at(-1);
    if (last && span.start < last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  let out = '';
  let cursor = 0;
  for (const span of merged) {
    out += content.slice(cursor, span.start) + span.token;
    cursor = span.end;
  }
  return { text: out + content.slice(cursor), count: merged.length };
}
