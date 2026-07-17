// JSON exporter: serializes the normalized Conversation model verbatim into a
// single JSON document. Provider-agnostic and DOM-free (docs/conventions.md) — it
// consumes only the Conversation, never site DOM. Unlike the Markdown/PDF exporters
// (which compose a human document), this one is a faithful, round-trippable dump of
// the model: `JSON.parse(toJson(c))` reconstructs an equal Conversation, so the file
// doubles as a machine-readable archive. Output is deterministic: the same
// Conversation yields the same bytes (JSON.stringify preserves the model's key order;
// no timestamp, Date, or randomness here).

import type { Conversation } from '../core/conversation';
import { buildExportFilename } from './filename';

/** Serialize a Conversation into one pretty-printed JSON document. Deterministic. */
export function toJson(conversation: Conversation): string {
  // 2-space indent for readability; trailing newline so the file is POSIX-friendly
  // and matches the Markdown exporter's convention. Optional undefined fields
  // (`id`, `createdAt`) are omitted by JSON.stringify rather than emitted as null.
  return JSON.stringify(conversation, null, 2) + '\n';
}

/**
 * Build the JSON download filename `{provider}-{safe-title}-{yyyymmdd}.json`.
 * Delegates sanitization to the shared filename builder (docs/conventions.md).
 */
export function jsonFilename(conversation: Conversation, now: Date): string {
  return buildExportFilename(conversation, now, 'json');
}
