// Supported ChatGPT hosts. Exact hostnames only — a suffix match would let a
// look-alike domain (e.g. chatgpt.com.attacker.example) pass.
const SUPPORTED_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

// A ChatGPT conversation lives at /c/<id> (optionally trailing-slashed).
const CONVERSATION_PATH = /^\/c\/[^/]+\/?$/;

/**
 * True only for a ChatGPT conversation page: a supported host with a `/c/<id>`
 * path. This is the single source of truth for "should the Download button be
 * shown?", so both the initial mount and SPA-navigation re-checks agree.
 */
export function isConversationPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return SUPPORTED_HOSTS.has(parsed.hostname) && CONVERSATION_PATH.test(parsed.pathname);
}
