// HTML exporter: renders the normalized Conversation model into a single, self-
// contained HTML document. Provider-agnostic and DOM-free (docs/conventions.md) —
// it builds the markup by string concatenation, never touching `document`, so it
// stays unit-testable. `Message.content` is already GitHub-flavored Markdown (the
// adapter normalized provider HTML upstream); rather than re-render it to rich HTML
// (which would need a Markdown parser), this exporter shows each message's Markdown
// verbatim inside an HTML-escaped `<pre>` block — a faithful source view. Output is
// deterministic: the same Conversation yields the same bytes (no timestamp, Date, or
// randomness here).

import type { Conversation, Role } from '../core/conversation';
import { buildExportFilename } from './filename';

// Human-readable section heading per role. Kept exhaustive over Role so a new role
// is a compile error here rather than a silently unlabeled section (mirrors the
// Markdown exporter's ROLE_HEADING).
const ROLE_HEADING: Record<Role, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
};

// Minimal, self-contained stylesheet: readable measure, role headings offset from
// the message body, and wrapped `<pre>` so long Markdown lines don't overflow.
const STYLE = [
  'body{max-width:48rem;margin:2rem auto;padding:0 1rem;',
  'font-family:system-ui,-apple-system,sans-serif;line-height:1.5}',
  'h1{font-size:1.5rem}',
  'section{margin:1.5rem 0}',
  'h2{font-size:1rem;text-transform:uppercase;letter-spacing:.05em;color:#666;margin:0 0 .5rem}',
  'pre{white-space:pre-wrap;word-wrap:break-word;font-family:ui-monospace,monospace;',
  'background:#f6f8fa;padding:1rem;border-radius:6px;margin:0}',
].join('');

/** Compose a Conversation into one self-contained HTML document. Deterministic. */
export function toHtml(conversation: Conversation): string {
  const sections = conversation.messages
    .map(
      (message) =>
        `<section><h2>${escapeHtml(ROLE_HEADING[message.role])}</h2>` +
        `<pre>${escapeHtml(message.content)}</pre></section>`,
    )
    .join('\n');
  const title = escapeHtml(conversation.title);
  return (
    '<!doctype html>\n' +
    '<html lang="en">\n' +
    `<head>\n<meta charset="utf-8">\n<title>${title}</title>\n<style>${STYLE}</style>\n</head>\n` +
    `<body>\n<h1>${title}</h1>\n${sections}\n</body>\n` +
    '</html>\n'
  );
}

/**
 * Build the HTML download filename `{provider}-{safe-title}-{yyyymmdd}.html`.
 * Delegates sanitization to the shared filename builder (docs/conventions.md).
 */
export function htmlFilename(conversation: Conversation, now: Date): string {
  return buildExportFilename(conversation, now, 'html');
}

// Escape the five characters that are significant in HTML text/attribute contexts,
// so conversation content can never inject markup into the exported document. `&`
// is replaced first so the entities introduced by the later replacements are not
// double-escaped.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
