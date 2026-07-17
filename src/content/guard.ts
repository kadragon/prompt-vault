import type { Conversation } from '../core/conversation';
import { ExtractionError } from '../core/errors';
import { EXPORT_EMPTY_MESSAGE } from '../strings';

/**
 * Defense-in-depth fail-loud guard (AGENTS.md #4): `runExport` relies on each
 * adapter to throw `ExtractionError` on an empty/malformed conversation, but the
 * exporters would still render a title-only document for a zero-message
 * `Conversation` if an adapter ever returned one without throwing. Enforce the
 * invariant at the single export chokepoint so both the Markdown and PDF paths
 * are covered, regardless of adapter behavior.
 */
export function assertConversationNonEmpty(conversation: Conversation): void {
  if (conversation.messages.length === 0) {
    throw new ExtractionError(EXPORT_EMPTY_MESSAGE);
  }
}
