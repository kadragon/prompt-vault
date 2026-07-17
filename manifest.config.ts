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
  // No `permissions` yet: the stub button does nothing. The download mechanism
  // (URL.createObjectURL + <a download>, per the design doc) needs no permission;
  // `downloads` is added in the export tickets only if chrome.downloads is used.
});
