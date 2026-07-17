// Markdown exporter: renders the normalized Conversation model into a single
// Markdown document. Provider-agnostic and DOM-free (docs/conventions.md) — it
// consumes only the Conversation, never site DOM. `Message.content` is already
// GitHub-flavored Markdown (the adapter normalizes provider HTML upstream), so
// this layer composes rather than re-parses. Output is deterministic: the same
// Conversation yields the same bytes (no timestamp, Date, or randomness here).

import type { Conversation, Role } from '../core/conversation';
import { escapeMarkdownText } from '../core/markdown-escape';
import { buildExportFilename } from './filename';

// Human-readable section heading per role. Kept exhaustive over Role so a new
// role is a compile error here rather than a silently unlabeled section.
const ROLE_HEADING: Record<Role, string> = {
  user: '## User',
  assistant: '## Assistant',
  system: '## System',
};

/** Compose a Conversation into one Markdown document. Deterministic. */
export function toMarkdown(conversation: Conversation): string {
  const blocks: string[] = [`# ${escapeMarkdownText(stripNewlines(conversation.title))}`];
  for (const message of conversation.messages) {
    blocks.push(`${ROLE_HEADING[message.role]}\n\n${message.content.trim()}`);
  }
  return blocks.join('\n\n') + '\n';
}

/**
 * Build the Markdown download filename `{provider}-{safe-title}-{yyyymmdd}.md`.
 * Delegates sanitization to the shared filename builder (docs/conventions.md).
 */
export function markdownFilename(conversation: Conversation, now: Date): string {
  return buildExportFilename(conversation, now, 'md');
}

// Flatten any newlines in the title so it stays a single Markdown heading line.
function stripNewlines(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}
