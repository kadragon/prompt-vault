import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

// Supported provider hosts. Kept minimal (least privilege): these are the only
// origins the extension may read or inject into. Each entry must correspond to a
// registered adapter in src/adapters/index.ts — a host without an adapter is an
// unjustified grant. New providers add sibling hosts.
const HOSTS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  // Claude — conversation pages live at https://claude.ai/chat/<id>. Host-broad for
  // the same reason as ChatGPT below (client-routed SPA); narrowed in JS by
  // isConversationPage().
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
  // name/description resolve via chrome.i18n against _locales/{en,ko}/messages.json
  // so Chrome shows a proper, localized display name instead of the package slug.
  name: '__MSG_appName__',
  version: pkg.version,
  description: '__MSG_appDesc__',
  // UI strings resolve via chrome.i18n against _locales/{en,ko}/messages.json,
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
  // on chatgpt.com, claude.ai and gemini.google.com. chat.openai.com could not be
  // confirmed the same way — it 308-redirects to chatgpt.com, so no document ever loads
  // on that origin for a content script to run in, with or without the grant. Full
  // numbers in docs/live-dom-verification.md; the decision is held by
  // test/privacy/manifest-least-privilege.test.ts.
  // `storage` is the only permission: the options page persists which toolbar icons to
  // show in chrome.storage.sync, and the content script reads them. Export still downloads
  // via URL.createObjectURL + an `<a download>` (no permission needed); `downloads` would
  // only be added if a future ticket switches to the chrome.downloads API.
  permissions: ['storage'],
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
