import { chatgptAdapter } from './chatgpt';
import type { ConversationAdapter } from './types';

// The adapter registry. A new provider adds its adapter here (and a manifest host)
// — nothing else in core or export changes (docs/architecture.md).
export const adapters: readonly ConversationAdapter[] = [chatgptAdapter];

/** The first adapter that handles this URL, or null if none does. */
export function pickAdapter(url: string): ConversationAdapter | null {
  return adapters.find((adapter) => adapter.matches(url)) ?? null;
}

export type { ConversationAdapter } from './types';
