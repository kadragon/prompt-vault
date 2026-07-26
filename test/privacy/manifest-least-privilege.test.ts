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

  it('declares the restrictive extension-pages CSP', () => {
    // The PRIMARY runtime control against subresource egress from the options page — MV3's
    // default policy restricts executable code only, so without these directives a remote
    // `<img>`/`<iframe>`/`<form action>` or a CSS `url()` still fetches. The HTML half of
    // no-external-network.test.ts is the static backup, not a substitute: it reads the tree,
    // not the running page.
    //
    // Compared as an EXACT source list per directive, not by substring. Containment catches a
    // directive being deleted but not one being widened, which is the likelier way this control
    // decays: `img-src 'self' https://cdn.evil.example` still contains `img-src 'self'` and would
    // pass green, and MV3 accepts remote sources for every directive here except script-src.
    const csp = declared.content_security_policy as { extension_pages?: string } | undefined;
    const parsed = new Map<string, string[]>(
      (csp?.extension_pages ?? '')
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .filter(([name]) => name)
        .map(([name, ...sources]) => [name.toLowerCase(), sources]),
    );
    const expected: Record<string, string[]> = {
      'script-src': ["'self'"],
      'object-src': ["'self'"],
      'img-src': ["'self'"],
      'media-src': ["'self'"],
      'font-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'connect-src': ["'self'"],
      'frame-src': ["'none'"],
      'form-action': ["'none'"],
      'base-uri': ["'none'"],
    };
    for (const [directive, sources] of Object.entries(expected)) {
      expect(parsed.get(directive), `extension_pages CSP: ${directive}`).toEqual(sources);
    }
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

  it('declares no host it cannot reach — chat.openai.com is redirect-only', () => {
    // A host that grants access to nothing is not "the minimum needed" (golden principle
    // #2): it costs a line in the install-time host warning and a row in the Web Store
    // justification for zero reach. `chat.openai.com` is exactly that — 308 to chatgpt.com
    // on /c/<id> (measured 2026-07-25) and on the bare root too (2026-07-26), so the
    // redirect is whole-origin and no document ever loads there for a content script.
    //
    // Re-adding it turns this gate red on purpose. The way back is to re-measure the
    // redirect and restore the entry with the new date, NOT to delete this assertion —
    // the finding this closes was explicit that a 308 measured once is not proof the
    // origin is permanently redirect-only, which cuts both ways.
    //
    // Note the JS host gate in src/adapters/chatgpt/matches.ts still lists the hostname;
    // that is deliberate (no permission cost, makes restoring it manifest-only) and is not
    // what this test is about, which is the manifest's granted surface.
    const scripts = declared.content_scripts as Array<{ matches?: string[] }> | undefined;
    const matches = scripts?.[0]?.matches ?? [];
    // Compared on the pattern's HOST component reduced to its registrable domain, which is
    // what makes the gate hard to slip past. Three shapes it has to reject, verified by
    // neutralization: `https://chat.openai.com/*`, the scheme-wildcard `*://chat.openai.com/*`,
    // and a path-scoped `https://chat.openai.com/c/*` — a whole-string match catches only the
    // first. Reducing to `openai.com` also rejects `https://*.openai.com/*`, a re-add that is
    // strictly WIDER than the entry removed here and would otherwise clear both this gate and
    // the bare-wildcard one above. Widening to the registrable domain is deliberate: the
    // measurement below covers chat.openai.com, so every other openai.com origin is simply
    // unmeasured, and an unmeasured host is exactly what must not be added by habit.
    //
    // Label arithmetic rather than a substring test, and not only to satisfy CodeQL: an
    // `includes('chat.openai.com')` check also matches `chat.openai.com.attacker.example`,
    // the same look-alike hazard that made SUPPORTED_HOSTS in
    // src/adapters/chatgpt/matches.ts an exact-hostname Set.
    const hostOf = (pattern: string) => pattern.replace(/^[^:]*:\/\//, '').split('/')[0];
    const registrableOf = (host: string) => host.split('.').slice(-2).join('.');
    expect(matches.map(hostOf).map(registrableOf)).not.toContain('openai.com');
  });
});
