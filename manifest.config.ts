import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

// Supported ChatGPT hosts. Kept minimal (least privilege): these are the only
// origins the extension may read or inject into. New providers add sibling hosts.
const HOSTS = ['https://chatgpt.com/*', 'https://chat.openai.com/*']

export default defineManifest({
  manifest_version: 3,
  name: 'prompt-vault',
  version: pkg.version,
  description: pkg.description,
  // Matches are host-broad because ChatGPT is a client-routed SPA (the script
  // must already be present when the user navigates into a /c/<id> page); the
  // conversation-page gate is enforced in JS via isConversationPage().
  content_scripts: [
    {
      matches: HOSTS,
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
    // MAIN-world hook that observes the page's own SPA router (history.pushState)
    // and re-broadcasts navigations to the isolated content script above. Must
    // run at document_start so it patches history before the app router loads.
    {
      matches: HOSTS,
      js: ['src/content/nav-hook.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    },
  ],
  host_permissions: HOSTS,
  // `downloads` is used by the Markdown/PDF export actions (later tickets).
  permissions: ['downloads'],
})
