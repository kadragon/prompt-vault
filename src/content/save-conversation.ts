// Headless export core: given a normalized Conversation, produce the file and save
// it with NO UI prompt — no alert, no in-flight guard, no button toggling. Those
// concerns stay in the UI layer (src/content/mount.ts). This is the "forward hook"
// the design reserved (docs/design/chatgpt-conversation-backup.md §Further Notes):
// the single-export button and the future bulk driver both call this, so the produce
// +save logic lives in exactly one place.

import type { Conversation } from '../core/conversation';
import { htmlFilename, toHtml } from '../export/html';
import { jsonFilename, toJson } from '../export/json';
import { markdownFilename, toMarkdown } from '../export/markdown';

// Export formats offered by every caller, in display order. Shared so the UI layer
// and the bulk orchestrator agree on one type.
export type ExportFormat = 'md' | 'pdf' | 'json' | 'html';

/**
 * Produce and download `conversation` in `format`, entirely locally. `now` is passed
 * in (not read from the clock) so the filename is caller-controlled and testable;
 * `doc` defaults to the live document and is injectable for tests. Throws on failure
 * (e.g. PDF generation) — the caller decides how to surface it (fail-loud, AGENTS.md
 * #4). No network primitive (Golden Principle #1).
 */
export async function saveConversation(
  conversation: Conversation,
  format: ExportFormat,
  now: Date,
  doc: Document = document,
): Promise<void> {
  if (format === 'pdf') {
    // pdfmake + the embedded CJK font are heavy; load them only on demand so an
    // ordinary page visit never pays for them (@crxjs code-splits this import).
    const { downloadPdf } = await import('./pdf-download');
    await downloadPdf(conversation, now);
    return;
  }
  // The text formats are lightweight (no heavy deps), so render + download eagerly.
  const { filename, text, mimeType } = renderTextExport(conversation, format, now);
  downloadTextFile(doc, filename, text, mimeType);
}

/**
 * Render a text-based export (everything except PDF) into its filename, body, and
 * MIME type. Exhaustive over the text `ExportFormat`s — a new format is a compile
 * error here (`format` narrows to `never` in the fallthrough) rather than a silent
 * miss.
 */
function renderTextExport(
  conversation: Conversation,
  format: Exclude<ExportFormat, 'pdf'>,
  now: Date,
): { filename: string; text: string; mimeType: string } {
  switch (format) {
    case 'md':
      return { filename: markdownFilename(conversation, now), text: toMarkdown(conversation), mimeType: 'text/markdown' };
    case 'json':
      return { filename: jsonFilename(conversation, now), text: toJson(conversation), mimeType: 'application/json' };
    case 'html':
      return { filename: htmlFilename(conversation, now), text: toHtml(conversation), mimeType: 'text/html' };
  }
}

/**
 * Trigger a local file download from an in-memory string via an object URL and a
 * transient `<a download>`. No network request (Golden Principle #1). Revocation is
 * deferred to a later task: the browser dispatches the download asynchronously after
 * `click()`, so revoking the object URL in the same tick can cancel an in-flight or
 * large download.
 */
export function downloadTextFile(doc: Document, filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
