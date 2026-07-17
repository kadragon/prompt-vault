// Shared download-filename builder for every exporter (Markdown, PDF, …). Pure
// and DOM-free (docs/conventions.md): given a Conversation, a Date, and an
// extension, it returns `{provider}-{safe-title}-{yyyymmdd}.{ext}` with the title
// sanitized into a filesystem-safe slug. Kept in one place so all formats share
// identical, well-tested sanitization rather than each re-deriving it.

import type { Conversation } from '../core/conversation';

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
 * Build the download filename `{provider}-{safe-title}-{yyyymmdd}.{ext}`
 * (docs/conventions.md). `now` is a parameter so the function is pure and
 * testable — the caller passes the current Date. `ext` is the extension without
 * a leading dot (e.g. `'md'`, `'pdf'`).
 */
export function buildExportFilename(conversation: Conversation, now: Date, ext: string): string {
  const date = yyyymmdd(now);
  const provider = conversation.provider;
  // Reserve bytes for the fixed parts so the title slug can never push the whole
  // filename over the byte budget: `{provider}-{slug}-{date}.{ext}`.
  const reserved = utf8Length(provider) + utf8Length(date) + utf8Length(ext) + '--.'.length;
  const slug = safeTitle(conversation.title, MAX_FILENAME_BYTES - reserved);
  return `${provider}-${slug}-${date}.${ext}`;
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
