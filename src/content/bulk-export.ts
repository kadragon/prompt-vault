// Sequential bulk-export orchestrator: iterate a list of targets, produce+save each
// one after another, and report a structured summary. Provider-agnostic and DOM-free
// — every side effect (producing a conversation, saving it, the delay) is injected,
// so the whole loop is unit-testable without real navigation, downloads, or timers.
// This is the design's "bulk driver [that] just iterates conversations and reuses
// [the export functions]" (docs/design/chatgpt-conversation-backup.md §Further Notes).
//
// Each target's `produce` is what makes the loop general: the live UI passes a
// closure that navigates the sidebar to the conversation and extracts it, while a
// caller holding already-extracted conversations passes `() => Promise.resolve(conv)`.
// Producing and saving are isolated together per item (see `bulkExport`).

import type { Conversation } from '../core/conversation';
import { saveConversation, type ExportFormat } from './save-conversation';

// Default spacing between saves. A browser prompts/throttles when a single page fires
// many downloads in quick succession, so spacing the saves out makes a batch download
// more reliably. DOM-free here — injected `sleep` keeps tests instant.
const DEFAULT_DELAY_MS = 300;

/** One conversation to export: its display title (for progress/failure) and how to obtain it. */
export interface BulkTarget {
  title: string;
  /** Obtain the full conversation to save (e.g. navigate to it and extract). May reject. */
  produce: () => Promise<Conversation>;
}

export interface BulkExportDeps {
  /** Produce+save one conversation. Defaults to the real headless saver. */
  save?: (conversation: Conversation, format: ExportFormat, now: Date) => Promise<string[]>;
  /** Wait between items. Injectable so tests need no real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Delay applied between (not after) items. */
  delayMs?: number;
  /**
   * Called at the start of each item with the zero-based index, total count, and the
   * item's title, so a UI can show "Exporting 2/5: …" while the (slow) produce runs.
   */
  onProgress?: (index: number, total: number, title: string) => void;
}

/** One target that failed to produce or save, kept for the caller to surface (never silent). */
export interface BulkFailure {
  title: string;
  error: string;
}

/**
 * One target that saved, but whose file could not render every character (PDF only —
 * see saveConversation). Separate from BulkFailure because the file IS there and is
 * worth keeping; without this the whole batch would report clean while every page was
 * tofu boxes, which is the silent degradation AGENTS.md #4 forbids.
 */
export interface BulkWarning {
  title: string;
  unsupported: string[];
}

export interface BulkExportSummary {
  total: number;
  /**
   * Count of items that produced AND saved without throwing — i.e. the file was
   * *dispatched* to the browser, NOT confirmed written to disk. A browser that
   * throttles rapid multi-downloads can drop a dispatched file without surfacing an
   * error here; real completion handling (`chrome.downloads` / spacing) is the live
   * driver's concern, not this core's.
   */
  succeeded: number;
  failed: BulkFailure[];
  /**
   * Items that saved with characters the embedded font could not draw. A subset of
   * `succeeded` — a warned item still counts as a success, because the file exists.
   */
  warnings: BulkWarning[];
}

/**
 * Produce and save every target in order, in `format`. Each item is isolated: any
 * failure — while producing (e.g. navigation timeout, empty extraction) or saving —
 * is captured in `failed[]` (title + message) and the remaining targets still run, so
 * one bad conversation never silently aborts the batch nor gets silently skipped
 * (per-item fail-loud, AGENTS.md #4). `sleep(delayMs)` runs BETWEEN items only (not
 * after the last). Returns the summary for the caller to surface; performs no `alert`.
 *
 * A save that succeeds but could not render every character lands in `warnings[]`
 * while still counting as a success — the file is there, it just has tofu boxes in it.
 *
 * Note: `succeeded` counts saves dispatched without error, not downloads confirmed on
 * disk (see `BulkExportSummary.succeeded`).
 */
export async function bulkExport(
  targets: BulkTarget[],
  format: ExportFormat,
  now: Date,
  deps: BulkExportDeps = {},
): Promise<BulkExportSummary> {
  const { save = saveConversation, sleep = defaultSleep, delayMs = DEFAULT_DELAY_MS, onProgress } = deps;

  const failed: BulkFailure[] = [];
  const warnings: BulkWarning[] = [];
  let succeeded = 0;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    onProgress?.(i, targets.length, target.title);
    try {
      const conversation = await target.produce();
      const unsupported = await save(conversation, format, now);
      succeeded++;
      if (unsupported.length > 0) warnings.push({ title: target.title, unsupported });
    } catch (error) {
      failed.push({ title: target.title, error: messageOf(error) });
    }
    if (i < targets.length - 1) await sleep(delayMs);
  }

  return { total: targets.length, succeeded, failed, warnings };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
