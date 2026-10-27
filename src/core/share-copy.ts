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
//     raw run of `* ~ | '` too, but only between local-part characters, so the delimiters
//     around `**a@x.io**` or `~~a@x.io~~` stay outside the match and the emphasis
//     still renders.
// The leading lookahead only lets a match start where an `@` follows within 128
// non-space characters (an RFC local part is at most 64; escapes can double it). Without
// it a long `@`-less run — a base64 blob, minified code, `a*a*a*…` — was rescanned from
// every offset to its end: quadratic, seconds per call on a 40k-char token, and the
// review modal recomputes on every change. A left-boundary lookbehind was tried first
// and dropped: it missed the second of two touching addresses (`a@x.com.b@y.com`) and
// left runs broken by `* ' \` quadratic.
const LOCAL_ATOM = String.raw`(?:[A-Za-z0-9._%+-]|\\[_*~|\`])+`;
const EMAIL = new RegExp(
  String.raw`(?=[^\s@]{1,128}@)${LOCAL_ATOM}(?:[*~|']+${LOCAL_ATOM})*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`,
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
const PHONE =
  /(?<![\d+]|\d\.)(?:\+\d{1,3}[-. ]?\d{1,4}(?:[-. ]?\d{3,4}){1,3}|0[1-9]\d?[-. ]\d{3,4}[-. ]?\d{4}|\(0[1-9]\d?\) ?\d{3,4}[-. ]\d{4})(?!\d)/g;

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
  const excluded = new Set(options.excluded.map(refKey));
  const termPatterns = manualTermPatterns(options.manualTerms);
  const kept = findShareCandidates(conversation).filter((c) => !excluded.has(refKey(c)));

  const messages: Message[] = conversation.messages.map((message, messageIndex) => {
    const spans: Span[] = kept
      .filter((c) => c.messageIndex === messageIndex)
      .map((c) => ({ start: c.start, end: c.end, token: TOKEN[c.kind] }));
    for (const pattern of termPatterns) spans.push(...termSpans(message.content, pattern));
    return { role: message.role, content: replaceSpans(message.content, spans) };
  });

  return { title: options.neutralTitle, provider: conversation.provider, url: '', messages };
}

interface Span {
  start: number;
  end: number;
  token: string;
}

function refKey(ref: ShareCandidateRef): string {
  return `${ref.messageIndex}:${ref.start}:${ref.end}`;
}

// One case-insensitive literal pattern per distinct non-blank term. Kept separate,
// not joined into one alternation: an alternation only reports non-overlapping
// matches, so a term overlapping an earlier match (`Smith & Co` after `John Smith`)
// would never become a span and its tail would survive.
function manualTermPatterns(terms: readonly string[]): RegExp[] {
  const usable = [...new Set(terms.filter((t) => t.trim() !== ''))];
  return usable.map((term) => new RegExp(termSource(term), 'gi'));
}

// A term is typed as plain text, but content is adapter Markdown in which
// escapeMarkdownText may have put a backslash before any ASCII punctuation
// (`[Falcon]` arrives as `\[Falcon\]`, `Acme_` as `Acme\_`). Each punctuation
// character therefore also matches with that optional backslash in front.
function termSource(term: string): string {
  let source = '';
  for (const char of term) {
    source += ASCII_PUNCTUATION.test(char) ? `\\\\?${escapeRegExp(char)}` : escapeRegExp(char);
  }
  return source;
}

const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;

// Every occurrence of one term, overlapping ones included (`ana` twice in `banana`):
// the scan restarts one code unit past each match start instead of past its end.
function termSpans(content: string, pattern: RegExp): Span[] {
  const spans: Span[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
    spans.push({ start: match.index, end: match.index + match[0].length, token: TOKEN.term });
    pattern.lastIndex = match.index + 1;
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
function replaceSpans(content: string, spans: Span[]): string {
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
  return out + content.slice(cursor);
}
