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

// Longest safe-title length kept in the filename; long conversation titles are
// truncated so the final filename stays within filesystem limits.
const MAX_TITLE_LEN = 80;

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
  return `${conversation.provider}-${safeTitle(conversation.title)}-${yyyymmdd(now)}.md`;
}

// Sanitize a conversation title into a filesystem-safe slug. Collapses every
// unsafe/whitespace run into a single dash, trims dashes, caps the length, and
// re-trims any dash left at the truncation boundary. Falls back to
// 'conversation' when the title sanitizes to nothing (empty or all-reserved) so
// the filename is never malformed.
function safeTitle(title: string): string {
  const slug = title
    .replace(UNSAFE_TITLE_CHARS, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TITLE_LEN)
    .replace(/-+$/g, '');
  return slug || 'conversation';
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
