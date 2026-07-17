// Markdown exporter: renders the normalized Conversation model into a single
// Markdown document. Provider-agnostic and DOM-free (docs/conventions.md) — it
// consumes only the Conversation, never site DOM. `Message.content` is already
// GitHub-flavored Markdown (the adapter normalizes provider HTML upstream), so
// this layer composes rather than re-parses. Output is deterministic: the same
// Conversation yields the same bytes (no timestamp, Date, or randomness here).

import type { Conversation, Role } from '../core/conversation';

// Human-readable section heading per role. Kept exhaustive over Role so a new
// role is a compile error here rather than a silently unlabeled section.
const ROLE_HEADING: Record<Role, string> = {
  user: '## User',
  assistant: '## Assistant',
  system: '## System',
};

/** Compose a Conversation into one Markdown document. Deterministic. */
export function toMarkdown(conversation: Conversation): string {
  const blocks: string[] = [`# ${stripNewlines(conversation.title)}`];
  for (const message of conversation.messages) {
    blocks.push(`${ROLE_HEADING[message.role]}\n\n${message.content.trim()}`);
  }
  return blocks.join('\n\n') + '\n';
}

// Readability cap on the title slug, in Unicode code points.
const MAX_TITLE_CODEPOINTS = 80;
// Byte budget for the whole filename. Kept well under the common 255-byte
// filesystem limit so an all-CJK title (3 bytes/char) still fits after the
// provider prefix, date, and extension are added.
const MAX_FILENAME_BYTES = 200;

// Path separators, filesystem-reserved chars, control chars (C0 + DEL),
// whitespace, and dashes — collapsed to single dashes when sanitizing a title
// into a filename.
const UNSAFE_TITLE_CHARS = /[\x00-\x1f\x7f/\\:*?"<>|\s-]+/g;

/**
 * Build the download filename `{provider}-{safe-title}-{yyyymmdd}.md`
 * (docs/conventions.md). `now` is a parameter so the function is pure and
 * testable — the caller passes the current Date.
 */
export function markdownFilename(conversation: Conversation, now: Date): string {
  const date = yyyymmdd(now);
  const provider = conversation.provider;
  // Reserve bytes for the fixed parts so the title slug can never push the whole
  // filename over the byte budget: `{provider}-{slug}-{date}.md`.
  const reserved = utf8Length(provider) + utf8Length(date) + '--.md'.length;
  const slug = safeTitle(conversation.title, MAX_FILENAME_BYTES - reserved);
  return `${provider}-${slug}-${date}.md`;
}

// Sanitize a conversation title into a filesystem-safe slug. Collapses every
// unsafe/whitespace run into a single dash, trims dashes, truncates to the
// readability cap AND the byte budget (whichever bites first) on whole-code-point
// boundaries — never splitting a surrogate pair — then re-trims any dash left at
// the truncation boundary. Falls back to 'conversation' when the title sanitizes
// to nothing (empty or all-reserved) so the filename is never malformed.
function safeTitle(title: string, maxBytes: number): string {
  const collapsed = title.replace(UNSAFE_TITLE_CHARS, '-').replace(/^-+|-+$/g, '');
  const slug = truncate(collapsed, MAX_TITLE_CODEPOINTS, maxBytes).replace(/-+$/g, '');
  return slug || 'conversation';
}

// Truncate `text` to at most `maxCodePoints` code points and `maxBytes` UTF-8
// bytes, iterating by code point so a multi-unit character (emoji, astral CJK) is
// never cut mid-surrogate into an invalid filename character.
function truncate(text: string, maxCodePoints: number, maxBytes: number): string {
  let codePoints = 0;
  let bytes = 0;
  let out = '';
  for (const char of text) {
    const size = utf8Length(char);
    if (codePoints + 1 > maxCodePoints || bytes + size > maxBytes) break;
    codePoints += 1;
    bytes += size;
    out += char;
  }
  return out;
}

// UTF-8 byte length of a string, computed from code points (no allocation).
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes;
}

// Local calendar date as YYYYMMDD, zero-padded.
function yyyymmdd(now: Date): string {
  const y = now.getFullYear().toString().padStart(4, '0');
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  return `${y}${m}${d}`;
}

// Flatten any newlines in the title so it stays a single Markdown heading line.
function stripNewlines(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}
