// Single source of truth for "is this a Claude conversation page?". Mirrors the
// ChatGPT adapter's gate (src/adapters/chatgpt/matches.ts) so the content-script
// mount gate and the adapter registry agree by calling the same function.

// Supported Claude hosts. Exact hostnames only — a suffix match would let a
// look-alike domain (e.g. claude.ai.attacker.example) pass. Only the apex host was
// observed serving conversations; a `www.` variant is deliberately NOT assumed.
// Verified against the live page (2026-07-25).
export const SUPPORTED_HOSTS = new Set(['claude.ai']);

// A Claude conversation lives at /chat/<id> (a UUID), optionally trailing-slashed.
// The app's other routes (/, /new, /projects/<id>, /recents) have no /chat/<id>
// segment and stay excluded. Extraction is DOM-based and id-agnostic once here, so
// the id segment is matched loosely rather than pinned to a UUID shape. Verified
// against the live page (2026-07-25).
export const CONVERSATION_PATH = /^\/chat\/[^/]+\/?$/;

// Claude exposes two measured project-home route families. Keep the id segment loose —
// the adapter only needs the route family here, while the project member links provide
// the stable conversation ids used by the bulk track.
export const PROJECT_PATHS = [/^\/cowork\/project\/[^/]+\/?$/, /^\/project\/[^/]+\/?$/] as const;

/**
 * True only for a Claude conversation page: a supported host with a `/chat/<id>`
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

/** True only for Claude Project home routes measured on 2026-08-09. */
export function matchesProject(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return SUPPORTED_HOSTS.has(parsed.hostname) && PROJECT_PATHS.some((path) => path.test(parsed.pathname));
}
