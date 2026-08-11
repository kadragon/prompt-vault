// The content-script mount gate for "should the export buttons be shown?".
// Host/path knowledge is provider-specific and lives in each adapter's `matches`
// (docs/architecture.md), so this asks the adapter registry rather than naming a
// provider — adding a provider is then a registry entry plus a manifest host, with
// no edit here. Dependency direction is unchanged (content → adapters).

import { pickAdapter, pickProjectAdapter, pickRecentsAdapter } from '../adapters';

/**
 * True for a conversation page of ANY registered provider. Single source of truth
 * for both the initial button mount and SPA-navigation re-checks; it agrees with
 * adapter selection by construction, since it is the same lookup `mount.ts` uses to
 * pick the adapter that will do the extracting.
 */
export function isConversationPage(url: string): boolean {
  return pickAdapter(url) !== null;
}

/**
 * True for a Project *home* page of any registered provider that implements the
 * project track (ChatGPT today; a provider omitting `matchesProject` never matches).
 * Gates the project bulk-download trigger, parallel to `isConversationPage` for the
 * per-conversation toolbar.
 */
export function isProjectPage(url: string): boolean {
  return pickProjectAdapter(url) !== null;
}

/**
 * True for the full-history list page of any registered provider that implements the recents
 * track (Claude's `/recents` today; a provider omitting `matchesRecents` never matches). Gates
 * the recents bulk-download trigger, parallel to `isProjectPage`.
 */
export function isRecentsPage(url: string): boolean {
  return pickRecentsAdapter(url) !== null;
}
