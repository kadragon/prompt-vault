import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { CONTAINER_ID } from '../../src/content/mount';
import { isCoachMarkVisible } from '../../src/content/coach-mark';

// src/content/index.ts is a side-effecting entry point: importing it IS running it. Each case
// builds a fresh happy-dom page, stubs the globals the entry reads, and imports a fresh module
// instance. Only the poll loop is replaced (a spy `tick`) — the coach mark, settings and
// onboarding modules run for real over an in-memory chrome.storage.
const tick = vi.fn();
vi.mock('../../src/content/bootstrap', () => ({
  NAV_POLL_MS: 500,
  createBootstrap: () => ({ tick, applySettings: vi.fn() }),
}));

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

function bootPage(): { window: Window; doc: Document; changeListeners: ChangeListener[] } {
  const window = new Window({ url: 'https://chatgpt.com/c/abc-123' });
  window.document.write('<body><main>page</main></body>');
  const doc = window.document as unknown as Document;
  const changeListeners: ChangeListener[] = [];
  const area = { get: () => Promise.resolve({}), set: () => Promise.resolve() };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', window);
  vi.stubGlobal('location', window.location);
  vi.stubGlobal('setInterval', vi.fn());
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  vi.stubGlobal('chrome', {
    ...g.chrome,
    storage: {
      sync: area,
      local: area,
      onChanged: { addListener: (l: ChangeListener) => changeListeners.push(l), removeListener: vi.fn() },
    },
  });
  return { window, doc, changeListeners };
}

async function runEntry(): Promise<void> {
  vi.resetModules();
  await import('../../src/content/index');
}

afterEach(() => {
  vi.unstubAllGlobals();
  tick.mockReset();
});

describe('content entry point', () => {
  it('re-syncs immediately on popstate (back/forward), not only on the next poll', async () => {
    const { window } = bootPage();
    await runEntry();
    const afterLoad = tick.mock.calls.length;

    window.dispatchEvent(new window.Event('popstate'));

    expect(tick).toHaveBeenCalledTimes(afterLoad + 1);
  });

  it('drops this tab’s coach mark when another tab persists the dismissal', async () => {
    const { doc, changeListeners } = bootPage();
    // A mounted toolbar is what lets the armed coach mark show on the entry's first sync.
    const toolbar = doc.createElement('div');
    toolbar.id = CONTAINER_ID;
    doc.body.appendChild(toolbar);
    await runEntry();
    await vi.waitFor(() => expect(isCoachMarkVisible(doc)).toBe(true));

    for (const listener of changeListeners) listener({ coachMarkDismissed: { newValue: true } }, 'local');

    expect(isCoachMarkVisible(doc)).toBe(false);
  });
});
