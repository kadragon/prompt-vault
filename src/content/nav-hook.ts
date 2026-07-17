import { NAV_EVENT } from './nav-event';

// This script is injected into the page's MAIN world (see manifest.config.ts).
// ChatGPT is a client-routed SPA whose router calls history.pushState in the
// main world; a content script in the isolated world cannot observe those calls
// (separate JS contexts). So we hook history here, in the main world, and
// re-broadcast each navigation as a DOM CustomEvent on the shared `window`,
// which the isolated-world content script listens for. No data crosses — the
// event is a bare signal to re-check the URL.

function emit(): void {
  window.dispatchEvent(new CustomEvent(NAV_EVENT));
}

type HistoryMethod = 'pushState' | 'replaceState';

function patch(method: HistoryMethod): void {
  const original = history[method].bind(history);
  history[method] = (...args: Parameters<History['pushState']>): void => {
    original(...args);
    emit();
  };
}

patch('pushState');
patch('replaceState');
window.addEventListener('popstate', emit);
