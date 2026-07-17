// Single source of truth for "is this a ChatGPT conversation page?". Both the
// content-script mount gate (src/content/page.ts re-exports this) and the adapter
// registry's provider selection agree because they call the same function.

// Supported ChatGPT hosts. Exact hostnames only — a suffix match would let a
// look-alike domain (e.g. chatgpt.com.attacker.example) pass.
export const SUPPORTED_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

// A ChatGPT conversation lives at /c/<id> (optionally trailing-slashed).
export const CONVERSATION_PATH = /^\/c\/[^/]+\/?$/;

/**
 * True only for a ChatGPT conversation page: a supported host with a `/c/<id>`
 * path. Invalid URLs return false rather than throwing.
 */
export function matches(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return SUPPORTED_HOSTS.has(parsed.hostname) && CONVERSATION_PATH.test(parsed.pathname);
}
