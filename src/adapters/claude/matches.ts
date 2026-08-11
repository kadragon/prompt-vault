// Single source of truth for "is this a Claude conversation page?". Mirrors the
// ChatGPT adapter's gate (src/adapters/chatgpt/matches.ts) so the content-script
// mount gate and the adapter registry agree by calling the same function.

// Supported Claude hosts. Exact hostnames only — a suffix match would let a
// look-alike domain (e.g. claude.ai.attacker.example) pass. Only the apex host was
// observed serving conversations; a `www.` variant is deliberately NOT assumed.
// Verified against the live page (2026-07-25).
export const SUPPORTED_HOSTS = new Set(['claude.ai']);

// A Claude conversation lives at /chat/<id> (a UUID), optionally trailing-slashed.
// The app's other routes (/, /new, /projects/<id>) have no /chat/<id> segment and stay
// excluded. `/recents` is excluded here too, but unlike the rest it is not meaningless
// to this adapter: it is the full-history list page, gated by `matchesRecents` below.
// Extraction is DOM-based and id-agnostic once here, so the id segment is matched
// loosely rather than pinned to a UUID shape. Verified against the live page (2026-07-25).
export const CONVERSATION_PATH = /^\/chat\/[^/]+\/?$/;

// Claude exposes two measured project-home route families. Keep the id segment loose —
// the adapter only needs the route family here, while the project member links provide
// the stable conversation ids used by the bulk track.
export const PROJECT_PATHS = [/^\/cowork\/project\/[^/]+\/?$/, /^\/project\/[^/]+\/?$/] as const;

// Claude's full-history list page. An EXACT path (optionally trailing-slashed), not a
// prefix: nothing below `/recents` was measured, and matching a nested route would offer
// the bulk trigger on a page whose table this adapter has never seen. Verified against the
// live page (2026-08-11).
export const RECENTS_PATH = /^\/recents\/?$/;

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

/**
 * True only for Claude's `/recents` history page, measured 2026-08-11. Same host + path
 * shape as `matchesProject`; invalid URLs return false rather than throwing.
 */
export function matchesRecents(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return SUPPORTED_HOSTS.has(parsed.hostname) && RECENTS_PATH.test(parsed.pathname);
}
