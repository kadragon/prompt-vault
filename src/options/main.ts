// Options page entry: load the persisted settings and render the form, wiring each change
// back to chrome.storage.sync. All DOM/logic lives in view.ts (injected `doc` + `save`) so
// this file is just the storage/document wiring. The content script picks up saves live via
// chrome.storage.onChanged (src/content/index.ts), so there is no explicit "apply".

import { loadSettings, saveSettings } from '../settings/store';
import { renderOptions } from './view';

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  renderOptions(document, app, await loadSettings(), (settings) => void saveSettings(settings));
}

void main();
