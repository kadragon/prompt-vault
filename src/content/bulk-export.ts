// Sequential bulk-export orchestrator: given several already-extracted conversations,
// save them one after another and report a structured summary. Provider-agnostic and
// DOM-free — the produce+save step and the delay are injectable, so the whole loop is
// unit-testable without real downloads or timers. This is the design's "bulk driver
// [that] just iterates conversations and reuses [the export functions]"
// (docs/design/chatgpt-conversation-backup.md §Further Notes). The live sidebar
// enumeration + cross-conversation navigation that produce the input array are a
// separate, deferred ticket (they need a logged-in session to verify).

import type { Conversation } from '../core/conversation';
import { saveConversation, type ExportFormat } from './save-conversation';

// Default spacing between saves. A browser prompts/throttles when a single page fires
// many downloads in quick succession, so a future live caller downloads more reliably
// when the saves are spaced out. DOM-free here — only the future live UI trigger cares.
const DEFAULT_DELAY_MS = 300;

export interface BulkExportDeps {
  /** Produce+save one conversation. Defaults to the real headless saver. */
  save?: (conversation: Conversation, format: ExportFormat, now: Date) => Promise<void>;
  /** Wait between saves. Injectable so tests need no real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Delay applied between (not after) saves. */
  delayMs?: number;
}

/** One conversation that failed to save, kept for the caller to surface (never silent). */
export interface BulkFailure {
  title: string;
  error: string;
}

export interface BulkExportSummary {
  total: number;
  succeeded: number;
  failed: BulkFailure[];
}

/**
 * Save every conversation in order, in `format`. Each save is isolated: a failure is
 * captured in `failed[]` (title + message) and the remaining conversations still save
 * — per-item fail-loud (AGENTS.md #4), so one bad turn never silently aborts the batch
 * nor gets silently skipped. `sleep(delayMs)` runs BETWEEN saves only (not after the
 * last). Returns the summary for the caller to surface; performs no `alert` itself.
 */
export async function bulkExport(
  conversations: Conversation[],
  format: ExportFormat,
  now: Date,
  deps: BulkExportDeps = {},
): Promise<BulkExportSummary> {
  const { save = saveConversation, sleep = defaultSleep, delayMs = DEFAULT_DELAY_MS } = deps;

  const failed: BulkFailure[] = [];
  let succeeded = 0;

  for (let i = 0; i < conversations.length; i++) {
    const conversation = conversations[i];
    try {
      await save(conversation, format, now);
      succeeded++;
    } catch (error) {
      failed.push({ title: conversation.title, error: messageOf(error) });
    }
    if (i < conversations.length - 1) await sleep(delayMs);
  }

  return { total: conversations.length, succeeded, failed };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
