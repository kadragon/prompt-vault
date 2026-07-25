import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import type { ConversationAdapter } from './types';

// The adapter registry. A new provider adds its adapter here (and a manifest host)
// — nothing else in core or export changes (docs/architecture.md). Order matters only
// as tie-breaking: each adapter's `matches` is host-scoped, so no two can claim a URL.
export const adapters: readonly ConversationAdapter[] = [chatgptAdapter, claudeAdapter];

/** The first adapter that handles this URL as a conversation page, or null if none does. */
export function pickAdapter(url: string): ConversationAdapter | null {
  return adapters.find((adapter) => adapter.matches(url)) ?? null;
}

/**
 * The first adapter that handles this URL as a Project home page, or null. Separate
 * from `pickAdapter` because a project *home* page is not a conversation page —
 * `matches` covers conversation pages only (`/c/<id>` and `/g/<gizmoId>/c/<convId>`),
 * so the single-conversation toolbar never mounts on a project home.
 */
export function pickProjectAdapter(url: string): ConversationAdapter | null {
  return adapters.find((adapter) => adapter.matchesProject?.(url)) ?? null;
}

export type { ConversationAdapter } from './types';
