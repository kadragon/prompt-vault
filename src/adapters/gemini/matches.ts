// Single source of truth for "is this a Gemini conversation page?". Mirrors the
// ChatGPT and Claude adapters' gates (src/adapters/{chatgpt,claude}/matches.ts) so the
// content-script mount gate and the adapter registry agree by calling the same function.

// Supported Gemini hosts. Exact hostname only — a suffix match would let a look-alike
// domain (e.g. gemini.google.com.attacker.example) pass. Only the apex app host was
// observed serving conversations. Verified against the live page (2026-07-25).
export const SUPPORTED_HOSTS = new Set(['gemini.google.com']);

// A Gemini conversation lives at /app/<id> (a 16-hex id), optionally trailing-slashed.
// `/app` with no id is the new-chat route and has nothing to export, so requiring a
// non-empty segment excludes it. Deeper routes — the Gems and project surfaces seen in the
// sidebar — are excluded too: their markup was never measured, and an adapter must not claim
// a page it has not been verified against (AGENTS.md #5). Extraction is DOM-based and
// id-agnostic once here, so the id segment is matched loosely rather than pinned to a hex
// shape. Verified against the live page (2026-07-25).
export const CONVERSATION_PATH = /^\/app\/[^/]+\/?$/;

/**
 * True only for a Gemini conversation page: a supported host with an `/app/<id>` path.
 * Invalid URLs return false rather than throwing.
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
