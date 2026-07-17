// The content-script mount gate for "should the Download button be shown?".
// The host/path knowledge is ChatGPT-specific, so it lives in the ChatGPT adapter
// (src/adapters/chatgpt/matches.ts) as the single source of truth; this re-export
// keeps the content-layer name and dependency direction (content → adapter).

import { matches } from '../adapters/chatgpt/matches';

/**
 * True only for a ChatGPT conversation page. Single source of truth for both the
 * initial button mount and SPA-navigation re-checks, and for adapter selection.
 */
export const isConversationPage = matches;
