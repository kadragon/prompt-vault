import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

// Supported ChatGPT hosts. Kept minimal (least privilege): these are the only
// origins the extension may read or inject into. New providers add sibling hosts.
const HOSTS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];

export default defineManifest({
  manifest_version: 3,
  name: 'prompt-vault',
  version: pkg.version,
  description: pkg.description,
  // UI strings resolve via chrome.i18n against _locales/{en,ko}/messages.json,
  // keyed to the browser's UI language. No extra permission needed.
  default_locale: 'en',
  // Matches are host-broad because ChatGPT is a client-routed SPA (the script
  // must already be present when the user navigates into a /c/<id> page); the
  // conversation-page gate is enforced in JS via isConversationPage(), and SPA
  // route changes are picked up by polling location in the content script.
  content_scripts: [
    {
      matches: HOSTS,
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  host_permissions: HOSTS,
  // `storage` is the only permission: the options page persists which toolbar icons to
  // show in chrome.storage.sync, and the content script reads them. Export still downloads
  // via URL.createObjectURL + an `<a download>` (no permission needed); `downloads` would
  // only be added if a future ticket switches to the chrome.downloads API.
  permissions: ['storage'],
  // Settings UI, embedded in chrome://extensions (open_in_tab: false). crxjs bundles the
  // referenced HTML entry and its module script into dist/.
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: false,
  },
});
