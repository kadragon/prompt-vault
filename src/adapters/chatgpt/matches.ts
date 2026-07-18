// Single source of truth for "is this a ChatGPT conversation page?". Both the
// content-script mount gate (src/content/page.ts re-exports this) and the adapter
// registry's provider selection agree because they call the same function.

// Supported ChatGPT hosts. Exact hostnames only — a suffix match would let a
// look-alike domain (e.g. chatgpt.com.attacker.example) pass.
export const SUPPORTED_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

// A ChatGPT conversation lives at /c/<id> (optionally trailing-slashed).
export const CONVERSATION_PATH = /^\/c\/[^/]+\/?$/;

// A ChatGPT Project home page lives at /g/g-p-<id>/project (optionally
// trailing-slashed). The `g-p-` prefix distinguishes a Project from a plain
// custom GPT (`g-<id>`); the project's own conversations live at
// /g/g-p-<id>[-slug]/c/<convId> and are NOT project home pages. Verified against
// the live site (2026-07-18).
export const PROJECT_PATH = /^\/g\/g-p-[^/]+\/project\/?$/;

/**
 * True only for a ChatGPT conversation page: a supported host with a `/c/<id>`
 * path. Invalid URLs return false rather than throwing.
 */
export function matches(url: string): boolean {
  return onSupportedHost(url, CONVERSATION_PATH);
}

/**
 * True only for a ChatGPT Project home page: a supported host with a
 * `/g/g-p-<id>/project` path. Distinct from `matches` so the single-conversation
 * toolbar gate stays `/c/<id>`-only; this gates the project bulk-download trigger.
 * Invalid URLs return false rather than throwing.
 */
export function matchesProject(url: string): boolean {
  return onSupportedHost(url, PROJECT_PATH);
}

/** Shared host check: a supported hostname whose pathname matches `pathPattern`. */
function onSupportedHost(url: string, pathPattern: RegExp): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return SUPPORTED_HOSTS.has(parsed.hostname) && pathPattern.test(parsed.pathname);
}
