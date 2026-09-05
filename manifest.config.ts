import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

// Supported provider hosts. Kept minimal (least privilege): these are the only
// origins the extension may read or inject into. Each entry must correspond to a
// registered adapter in src/adapters/index.ts — a host without an adapter is an
// unjustified grant. New providers add sibling hosts.
const HOSTS = [
  // ChatGPT — conversation pages live at https://chatgpt.com/c/<id>. The sibling origin
  // `https://chat.openai.com/*` is deliberately NOT declared: it is redirect-only. Measured
  // 2026-07-25 on /c/<id> and re-measured 2026-07-26 on BOTH /c/<id> and the bare root — every
  // request returns HTTP 308 to chatgpt.com, so the redirect is whole-origin and no document
  // ever loads there for a content script to run in. Declaring it would cost a line in the
  // install-time host warning and a row in the Web Store justification while reaching nothing,
  // which Golden Principle #2 (least privilege) forbids. If OpenAI ever serves conversation
  // pages there again, re-measure first and then restore the entry — do not restore it by
  // habit. Held by test/privacy/manifest-least-privilege.test.ts; the JS host gate in
  // src/adapters/chatgpt/matches.ts still lists the origin, deliberately (see its comment).
  'https://chatgpt.com/*',
  // Claude — conversation pages live at https://claude.ai/chat/<id>. Host-broad for the
  // same reason as every entry here (client-routed SPA — see the content_scripts comment
  // below); narrowed in JS by isConversationPage().
  'https://claude.ai/*',
  // Gemini — conversation pages live at https://gemini.google.com/app/<id>. Host-broad for
  // the same reason as the entries above (client-routed SPA); narrowed in JS by
  // isConversationPage(), which excludes /app (new chat) and the unmeasured Gems/project
  // routes. Scoped to the gemini subdomain only — NOT google.com, which would be a vastly
  // wider grant covering Search, Gmail and every other Google property.
  'https://gemini.google.com/*',
];

export default defineManifest({
  manifest_version: 3,
  // name/description resolve via chrome.i18n against _locales/<locale>/messages.json
  // so Chrome shows a proper, localized display name instead of the package slug.
  name: '__MSG_appName__',
  version: pkg.version,
  description: '__MSG_appDesc__',
  // UI strings resolve via chrome.i18n against _locales/<locale>/messages.json (en, ko,
  // ja, zh_CN, zh_TW),
  // keyed to the browser's UI language. No extra permission needed.
  default_locale: 'en',
  // Toolbar/extension-list icons. crxjs copies public/ into dist/ verbatim, so
  // these paths are relative to the built extension root.
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  // Matches are host-broad because these are client-routed SPAs (the script must
  // already be present when the user navigates into a /c/<id> or /chat/<id> page);
  // the conversation-page gate is enforced in JS via isConversationPage(), and SPA
  // route changes are picked up by polling location in the content script.
  content_scripts: [
    {
      matches: HOSTS,
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  // No `host_permissions`. Dropped 2026-07-25 by experiment, not by argument: a
  // *statically declared* content script injects on `matches` alone, and the grant only
  // adds cross-origin fetch/cookie access from an extension context — which this
  // extension does not have (no background service worker, no network primitives
  // anywhere in src/, downloads via URL.createObjectURL + <a download>). A build with
  // the grant removed was loaded unpacked and the toolbar confirmed to mount AND export
  // on chatgpt.com, claude.ai and gemini.google.com — the three hosts declared above.
  // chat.openai.com, then still declared, could not be confirmed the same way because it
  // 308-redirects; that entry has since been dropped for the reason recorded in HOSTS. Full
  // numbers in docs/live-dom-verification.md; the decision is held by
  // test/privacy/manifest-least-privilege.test.ts.
  // `storage` is the only permission: the options page persists which toolbar icons to
  // show in chrome.storage.sync, and the content script reads them. Export still downloads
  // via URL.createObjectURL + an `<a download>` (no permission needed); `downloads` would
  // only be added if a future ticket switches to the chrome.downloads API.
  permissions: ['storage'],
  // The two PDF font faces, read at export time over a `chrome-extension://` URL
  // (src/export/fonts/jetendard.ts). They used to ride into the PDF chunk as base64
  // via Vite's `?inline`, which cost 13,399 kB of script per export; shipping them as
  // package resources instead means the bytes are fetched, not parsed.
  //
  // `matches` is the same three-host list the content script uses, and that scope is
  // the whole least-privilege story here (Golden Principle #2): a web-accessible
  // resource is readable by any page the `matches` list admits, and a fixed
  // `chrome-extension://<id>/...` URL that resolves is also an extension-detection
  // signal for that page. Narrow it to the origins that actually need the fonts —
  // never `<all_urls>` — and keep `resources` to the two faces, never a directory
  // wildcard that could later admit source. Held by
  // test/privacy/manifest-least-privilege.test.ts.
  web_accessible_resources: [
    {
      resources: ['fonts/Jetendard-Regular.ttf', 'fonts/Jetendard-Bold.ttf'],
      matches: HOSTS,
    },
  ],
  // Explicit CSP for extension pages — the PRIMARY control against subresource egress from the
  // options page, with the HTML half of test/privacy/no-external-network.test.ts as the static
  // backup. MV3's default (`script-src 'self'; object-src 'self'`) restricts executable code only,
  // so without this a remote `<img>`/`<iframe>`/`<form action>` — or a `url()` in the page's inline
  // `<style>` — is a working outbound channel for anything that page can read, which Golden
  // Principle #1 forbids. Directive by directive:
  //   script-src/object-src 'self' — restate the MV3 default; Chrome rejects relaxing them.
  //   img-src/media-src/font-src 'self' — close the subresource vectors. These also govern what the
  //     inline CSS may fetch (`background: url(...)` is img-src, NOT style-src).
  //   frame-src/form-action 'none' — the options page has neither an iframe nor a `<form>`
  //     (src/options/main.ts renders checkboxes), so nothing legitimate needs either.
  //   base-uri 'none' — a `<base href>` would retarget every relative URL to a remote origin, which
  //     is exactly what the gate's relative-path allowance assumes cannot happen.
  //   style-src 'self' 'unsafe-inline' — src/options/index.html ships an inline `<style>` block, so
  //     the inline allowance is required; what matters is the 'self', which stops a remote
  //     `@import`. MV3 rejects 'unsafe-inline' for script-src, NOT for style-src (measured: the
  //     built extension loads with no error card — see docs/live-dom-verification.md).
  //   connect-src 'self' — closes fetch/XHR/WebSocket/EventSource/sendBeacon from an extension
  //     page. Added on review: it had been left out on the grounds that crxjs's dev-mode HMR needs
  //     localhost, which is not a cost this repo pays — there is no `dev` script, `build` is plain
  //     `vite build`. With no `default-src`, an unlisted directive is unrestricted rather than
  //     defaulted, so the omission was a real hole, not a formality.
  // Note what this does NOT reach: a content script runs in the HOST page's world, so none of these
  // directives apply to it. That side is held statically by the JS/TS half of
  // test/privacy/no-external-network.test.ts, whose FORBIDDEN list covers WebSocket and EventSource
  // for exactly this reason. Held by test/privacy/manifest-least-privilege.test.ts.
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; img-src 'self'; media-src 'self'; " +
      "font-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
      "frame-src 'none'; form-action 'none'; base-uri 'none'",
  },
  // Toolbar icon → clicking it opens the settings form as a popup. Reuses the very same
  // page as options_ui below (Chrome allows one HTML file to serve both slots), so there
  // is a single settings UI reachable two ways: the toolbar icon and the chrome://extensions
  // "Extension options" link. No permission needed for `action`.
  action: {
    default_title: '__MSG_appName__',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
    },
    default_popup: 'src/options/index.html',
  },
  // Settings UI, embedded in chrome://extensions (open_in_tab: false). crxjs bundles the
  // referenced HTML entry and its module script into dist/.
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: false,
  },
});
