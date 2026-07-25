import { describe, it, expect } from 'vitest';
import manifest from '../../manifest.config';

// Golden principle #2 (least-privilege MV3) enforced mechanically, and the
// standing answer to "is `host_permissions` needed at all?" so nobody has to
// re-derive it.
//
// The grant was dropped after a live experiment (see docs/live-dom-verification.md):
// a *statically declared* content script injects on `content_scripts.matches`
// alone, and `host_permissions` only adds cross-origin fetch/cookie access from
// an extension context — which this extension has none of (no background service
// worker, no network primitives, downloads via URL.createObjectURL). Re-adding it
// turns this gate red on purpose: it is not a style rule, it is a decision that
// must be re-measured, not reverted by habit.
//
// Asserted against manifest.config.ts, not dist/manifest.json: dist/ is a build
// artifact and is not committed, so a dist-based gate would pass vacuously on a
// clean checkout. @crxjs's defineManifest returns its argument unchanged, so the
// imported object IS what gets emitted.

// Narrow the ManifestV3Export union (it also admits a function/promise form) to
// the plain object this repo actually declares, so the assertions below can read
// its keys without `any`.
const declared = manifest as unknown as Record<string, unknown>;

describe('least-privilege manifest', () => {
  it('declares no host_permissions', () => {
    // Key presence, not a truthiness check: an empty array or an explicit
    // `undefined` value would still mean someone re-introduced the key.
    expect(Object.keys(declared)).not.toContain('host_permissions');
  });

  it('grants no API permission beyond storage', () => {
    // `storage` backs the options page's toolbar-visibility preferences. Anything
    // else needs its own justification in docs/store-listing.md and PRIVACY.md.
    expect(declared.permissions).toEqual(['storage']);
  });

  it('reaches its hosts through content_scripts.matches', () => {
    // With host_permissions gone, `matches` is the ONLY thing granting host access.
    // If it were ever emptied the extension would silently stop mounting anywhere,
    // so assert it is populated and https-scoped rather than merely present.
    const scripts = declared.content_scripts as Array<{ matches?: string[] }> | undefined;
    expect(scripts).toHaveLength(1);
    const matches = scripts?.[0]?.matches ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const pattern of matches) {
      expect(pattern).toMatch(/^https:\/\//);
      // Never the bare-scheme wildcard `https://*/*`, the <all_urls> equivalent
      // (docs/conventions.md). Deliberately anchored on the trailing slash so a
      // narrow subdomain pattern like `https://*.claude.ai/*` still passes — that
      // is a host-list review question, not a bare privilege escalation.
      expect(pattern).not.toMatch(/^https:\/\/\*\//);
    }
  });
});
