import { afterEach, describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import {
  CONTAINER_ID,
  createButtons,
  createProjectTrigger,
  createRecentsTrigger,
  removeButtons,
  setToolbarSettings,
  syncButtons,
} from '../../src/content/mount';
import { BULK_PANEL_ID } from '../../src/content/bulk-panel';
import { DEFAULT_SETTINGS } from '../../src/settings/store';

// setToolbarSettings mutates module state; reset to the all-on default after every test so
// the filtering cases below never leak into the syncButtons tests that assume a full toolbar.
afterEach(() => {
  setToolbarSettings(DEFAULT_SETTINGS);
  vi.unstubAllGlobals();
});

const CONV_URL = 'https://chatgpt.com/c/abc-123';
const NON_CONV_URL = 'https://chatgpt.com/';
const PROJECT_URL = 'https://chatgpt.com/g/g-p-abc123/project';
const HEADER_ID = 'conversation-header-actions';

// A Project home page whose conversation-list <section> is the trigger's native mount.
function docWithProjectSection(): Document {
  const window = new Window();
  window.document.write(
    '<body><main><section><ol><li>' +
      '<a href="/g/g-p-abc123-demo/c/conv-1" data-discover="true">' +
      '<div class="text-sm font-medium">A project chat</div></a>' +
      '</li></ol></section></main></body>',
  );
  return window.document as unknown as Document;
}

function docWithHeader(): Document {
  const window = new Window();
  window.document.write(
    `<body><header><div id="${HEADER_ID}"><button data-testid="share-chat-button"></button></div></header></body>`,
  );
  return window.document as unknown as Document;
}

function bareDoc(): Document {
  const window = new Window();
  window.document.write('<body></body>');
  return window.document as unknown as Document;
}

const CLAUDE_CONV_URL = 'https://claude.ai/chat/abc-123';
const CLAUDE_PROJECT_URL = 'https://claude.ai/project/abc-123';
const CLAUDE_RECENTS_URL = 'https://claude.ai/recents';
const CLAUDE_ACTIONS_ID = 'wiggle-controls-actions';

// Claude's header action bar, whose only child is its native Share button.
function docWithClaudeHeader(): Document {
  const window = new Window();
  window.document.write(
    `<body><header><div data-testid="${CLAUDE_ACTIONS_ID}">` +
      `<button data-testid="${CLAUDE_ACTIONS_ID}-share"></button>` +
      '</div></header></body>',
  );
  return window.document as unknown as Document;
}

function docWithClaudeProjectTable(): Document {
  const window = new Window();
  window.document.write(
    '<body><main><table data-cds="Table"><tbody><tr class="group/cdsrow"><td>' +
      '<a href="/chat/project-chat" aria-label="Project chat">Project chat</a>' +
      '</td></tr></tbody></table></main></body>',
  );
  return window.document as unknown as Document;
}

// Claude's `/recents` history page: the measured `main table` of chat links, whose parent is
// the trigger's native mount (docs/live-dom-verification.md → Claude → 2026-08-11).
function docWithClaudeRecentsTable(): Document {
  const window = new Window({ url: CLAUDE_RECENTS_URL });
  window.document.write(
    '<body><main><table data-cds="Table"><tbody>' +
      '<tr class="group/cdsrow"><td><a href="/chat/recent-1" aria-label="First recent">First recent</a></td></tr>' +
      '<tr class="group/cdsrow"><td><a href="/chat/recent-2" aria-label="Second recent">Second recent</a></td></tr>' +
      '</tbody></table></main></body>',
  );
  return window.document as unknown as Document;
}

describe('syncButtons', () => {
  it('injects the buttons inside the header bar on a conversation page', () => {
    const doc = docWithHeader();
    syncButtons(doc, CONV_URL);

    const container = doc.getElementById(CONTAINER_ID);
    expect(container).not.toBeNull();
    expect(container?.parentElement?.id).toBe(HEADER_ID);
    expect(container?.querySelectorAll('button').length).toBe(5);
    // Native buttons wear the ChatGPT adapter's icon-button class so they blend with
    // the header's native square icon controls.
    expect(container?.querySelector('button')?.className).toContain('rounded-lg');
  });

  it('renders the bulk icon once the provider implements its measured bulk track', () => {
    const doc = docWithClaudeHeader();
    syncButtons(doc, CLAUDE_CONV_URL);

    const container = doc.getElementById(CONTAINER_ID);
    expect(container).not.toBeNull();
    expect(container?.parentElement?.getAttribute('data-testid')).toBe(CLAUDE_ACTIONS_ID);
    // Four format downloads plus the Claude sidebar bulk action.
    expect(container?.querySelectorAll('button').length).toBe(5);
    const labels = Array.from(container?.querySelectorAll('button') ?? []).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toContain('Export multiple conversations');
  });

  it('still renders the bulk icon on a provider whose adapter implements the bulk track', () => {
    const doc = docWithHeader();
    syncButtons(doc, CONV_URL);

    const labels = Array.from(doc.getElementById(CONTAINER_ID)?.querySelectorAll('button') ?? []).map(
      (b) => b.getAttribute('aria-label'),
    );
    expect(labels).toContain('Export multiple conversations');
  });

  it('places the buttons immediately to the left of the native Share button, leaving it in place', () => {
    const doc = docWithHeader();
    syncButtons(doc, CONV_URL);

    const share = doc.querySelector('[data-testid="share-chat-button"]');
    const container = doc.getElementById(CONTAINER_ID);
    // Share is untouched (not replaced or hidden), and our container sits right before it.
    expect(share).not.toBeNull();
    expect(container?.nextElementSibling).toBe(share);
  });

  it('mounts at the front of the bar when the Share anchor is absent', () => {
    const window = new Window();
    window.document.write(`<body><header><div id="${HEADER_ID}"><button id="other"></button></div></header></body>`);
    const doc = window.document as unknown as Document;
    syncButtons(doc, CONV_URL);

    const container = doc.getElementById(CONTAINER_ID);
    expect(container?.parentElement?.id).toBe(HEADER_ID);
    expect(container?.previousElementSibling).toBeNull(); // first child of the bar
  });

  it('repositions to the left of Share when the anchor renders after the first mount', () => {
    // Staged SPA render: the header bar exists but Share has not rendered yet.
    const window = new Window();
    window.document.write(`<body><header><div id="${HEADER_ID}"></div></header></body>`);
    const doc = window.document as unknown as Document;
    syncButtons(doc, CONV_URL); // mounts at the front (no anchor yet)

    // Share renders late, inserted before our already-mounted container.
    const header = doc.getElementById(HEADER_ID)!;
    const share = doc.createElement('button');
    share.setAttribute('data-testid', 'share-chat-button');
    header.prepend(share);
    expect(doc.getElementById(CONTAINER_ID)?.previousElementSibling).toBe(share); // now wrongly right of Share

    syncButtons(doc, CONV_URL); // re-assert: must move left of Share
    expect(doc.getElementById(CONTAINER_ID)?.nextElementSibling).toBe(share);
    expect(doc.querySelectorAll(`#${CONTAINER_ID}`).length).toBe(1); // moved, not duplicated
  });

  it('is idempotent — repeated calls do not duplicate the buttons', () => {
    const doc = docWithHeader();
    syncButtons(doc, CONV_URL);
    syncButtons(doc, CONV_URL);
    syncButtons(doc, CONV_URL);

    const header = doc.getElementById(HEADER_ID);
    // 4 per-format buttons + the bulk button + the fixture's Share button.
    expect(header?.querySelectorAll('button').length).toBe(6);
    expect(doc.querySelectorAll(`#${CONTAINER_ID}`).length).toBe(1);
  });

  it('re-injects after an SPA header re-render drops the node', () => {
    const doc = docWithHeader();
    syncButtons(doc, CONV_URL);

    // Simulate React re-rendering the header and wiping our injected node.
    const header = doc.getElementById(HEADER_ID);
    if (header) header.innerHTML = '';
    expect(doc.getElementById(CONTAINER_ID)).toBeNull();

    syncButtons(doc, CONV_URL);
    expect(doc.getElementById(CONTAINER_ID)?.parentElement?.id).toBe(HEADER_ID);
  });

  it('removes the buttons when navigating to a non-conversation page', () => {
    const doc = docWithHeader();
    syncButtons(doc, CONV_URL);
    expect(doc.getElementById(CONTAINER_ID)).not.toBeNull();

    syncButtons(doc, NON_CONV_URL);
    expect(doc.getElementById(CONTAINER_ID)).toBeNull();
  });

  it('does not inject an overlay while the header may still be rendering (fallback disallowed)', () => {
    const doc = bareDoc();
    syncButtons(doc, CONV_URL, { allowOverlayFallback: false });
    expect(doc.getElementById(CONTAINER_ID)).toBeNull();
  });

  it('falls back to a non-overlapping bottom-right overlay when the header is truly absent', () => {
    const doc = bareDoc();
    syncButtons(doc, CONV_URL, { allowOverlayFallback: true });

    const container = doc.getElementById(CONTAINER_ID);
    expect(container?.parentElement?.tagName).toBe('BODY');
    expect(container?.style.position).toBe('fixed');
    // Anchored to the bottom, never the top, so it cannot cover the Share button.
    expect(container?.style.bottom).toBe('12px');
    expect(container?.style.top).toBe('');
  });

  it('upgrades an already-mounted overlay to the native header once it renders', () => {
    // Header absent → overlay fallback mounts in the body.
    const doc = bareDoc();
    syncButtons(doc, CONV_URL, { allowOverlayFallback: true });
    expect(doc.getElementById(CONTAINER_ID)?.parentElement?.tagName).toBe('BODY');

    // Header renders late; next sync should swap the overlay for the native placement.
    const header = doc.createElement('div');
    header.id = HEADER_ID;
    doc.body.appendChild(header);
    syncButtons(doc, CONV_URL, { allowOverlayFallback: true });

    const container = doc.getElementById(CONTAINER_ID);
    expect(container?.parentElement?.id).toBe(HEADER_ID);
    expect(container?.style.position).toBe(''); // native container is not a fixed overlay
    expect(doc.querySelectorAll(`#${CONTAINER_ID}`).length).toBe(1); // overlay removed, not duplicated
  });
});

describe('syncButtons on a Project home page', () => {
  it('mounts the "Download all" trigger into the project conversation-list section', () => {
    const doc = docWithProjectSection();
    syncButtons(doc, PROJECT_URL);

    const container = doc.getElementById(CONTAINER_ID);
    expect(container).not.toBeNull();
    expect(container?.parentElement?.tagName).toBe('SECTION');
    // Prepended above the list.
    expect(container?.previousElementSibling).toBeNull();
    const button = container?.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Download all conversations in this project');
    expect(button?.textContent).toContain('Download all');
    // Wears ChatGPT's own secondary-button classes so it blends with native controls.
    expect(button?.className).toContain('btn-secondary');
  });

  it('does not mount the per-conversation format toolbar on a project page', () => {
    const doc = docWithProjectSection();
    syncButtons(doc, PROJECT_URL);
    // A single trigger button, not the 4 format buttons + bulk icon.
    expect(doc.querySelectorAll(`#${CONTAINER_ID} button`).length).toBe(1);
  });

  it('is idempotent — repeated calls keep a single trigger', () => {
    const doc = docWithProjectSection();
    syncButtons(doc, PROJECT_URL);
    syncButtons(doc, PROJECT_URL);
    syncButtons(doc, PROJECT_URL);
    expect(doc.querySelectorAll(`#${CONTAINER_ID}`).length).toBe(1);
  });

  it('does not mount the trigger when the bulk-export setting is disabled', () => {
    setToolbarSettings({ formats: { md: true, pdf: true, json: true, html: true }, bulk: false });
    const doc = docWithProjectSection();
    syncButtons(doc, PROJECT_URL);
    expect(doc.getElementById(CONTAINER_ID)).toBeNull();
  });

  it('removes an existing trigger when the bulk setting is turned off', () => {
    const doc = docWithProjectSection();
    syncButtons(doc, PROJECT_URL);
    expect(doc.getElementById(CONTAINER_ID)).not.toBeNull();

    setToolbarSettings({ formats: { md: true, pdf: true, json: true, html: true }, bulk: false });
    syncButtons(doc, PROJECT_URL);
    expect(doc.getElementById(CONTAINER_ID)).toBeNull();
  });

  it('removes the trigger when navigating away to a non-project page', () => {
    const doc = docWithProjectSection();
    syncButtons(doc, PROJECT_URL);
    expect(doc.getElementById(CONTAINER_ID)).not.toBeNull();

    syncButtons(doc, NON_CONV_URL);
    expect(doc.getElementById(CONTAINER_ID)).toBeNull();
  });

  it('does not inject an overlay while the section may still be rendering (fallback disallowed)', () => {
    const doc = bareDoc();
    syncButtons(doc, PROJECT_URL, { allowOverlayFallback: false });
    expect(doc.getElementById(CONTAINER_ID)).toBeNull();
  });

  it('falls back to a bottom-right overlay when the project section is truly absent', () => {
    const doc = bareDoc();
    syncButtons(doc, PROJECT_URL, { allowOverlayFallback: true });

    const container = doc.getElementById(CONTAINER_ID);
    expect(container?.parentElement?.tagName).toBe('BODY');
    expect(container?.style.position).toBe('fixed');
    expect(container?.style.bottom).toBe('12px');
  });

  it('upgrades an already-mounted overlay to the native section once it renders', () => {
    const doc = bareDoc();
    syncButtons(doc, PROJECT_URL, { allowOverlayFallback: true });
    expect(doc.getElementById(CONTAINER_ID)?.parentElement?.tagName).toBe('BODY');

    // The project list section renders late; next sync swaps the overlay for the native mount.
    const section = doc.createElement('section');
    const anchor = doc.createElement('a');
    anchor.setAttribute('href', '/g/g-p-abc123-demo/c/conv-1');
    section.appendChild(anchor);
    doc.querySelector('body')?.appendChild(section);
    syncButtons(doc, PROJECT_URL, { allowOverlayFallback: true });

    const container = doc.getElementById(CONTAINER_ID);
    expect(container?.parentElement?.tagName).toBe('SECTION');
    expect(container?.style.position).toBe('');
    expect(doc.querySelectorAll(`#${CONTAINER_ID}`).length).toBe(1);
  });
});

describe('syncButtons on a Claude Project home page', () => {
  it('mounts the existing project bulk trigger on the measured table parent', () => {
    const doc = docWithClaudeProjectTable();
    syncButtons(doc, CLAUDE_PROJECT_URL);

    const container = doc.getElementById(CONTAINER_ID);
    expect(container?.parentElement?.tagName).toBe('MAIN');
    expect(container?.querySelectorAll('button').length).toBe(1);
    expect(container?.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Download all conversations in this project',
    );
  });

  it('recognizes the alternate measured cowork project route', () => {
    const doc = docWithClaudeProjectTable();
    syncButtons(doc, 'https://claude.ai/cowork/project/abc-123');
    expect(doc.getElementById(CONTAINER_ID)).not.toBeNull();
  });
});

describe('syncButtons on Claude’s /recents history page', () => {
  it('mounts the recents bulk trigger on the measured table parent', () => {
    const doc = docWithClaudeRecentsTable();
    syncButtons(doc, CLAUDE_RECENTS_URL);

    const container = doc.getElementById(CONTAINER_ID);
    expect(container?.parentElement?.tagName).toBe('MAIN');
    expect(container?.querySelectorAll('button').length).toBe(1);
    // The whole point of the separate track: on `/recents` the trigger covers the entire
    // history, so announcing it as "this project" would be wrong.
    expect(container?.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Download all recent conversations',
    );
  });

  it('accepts the trailing-slash form of the route', () => {
    const doc = docWithClaudeRecentsTable();
    syncButtons(doc, 'https://claude.ai/recents/');
    expect(doc.getElementById(CONTAINER_ID)).not.toBeNull();
  });

  it('falls back to a bottom-right overlay when the list has not rendered', () => {
    const window = new Window({ url: CLAUDE_RECENTS_URL });
    window.document.write('<body><main>still hydrating</main></body>');
    const doc = window.document as unknown as Document;

    syncButtons(doc, CLAUDE_RECENTS_URL, { allowOverlayFallback: true });
    const container = doc.getElementById(CONTAINER_ID);
    expect(container?.parentElement?.tagName).toBe('BODY');
    expect(container?.style.position).toBe('fixed');
    expect(container?.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Download all recent conversations',
    );
  });

  it('honours the bulk toolbar setting, as the project trigger does', () => {
    const doc = docWithClaudeRecentsTable();
    setToolbarSettings({ ...DEFAULT_SETTINGS, bulk: false });
    syncButtons(doc, CLAUDE_RECENTS_URL);
    expect(doc.getElementById(CONTAINER_ID)).toBeNull();
  });

  it('opens the bulk panel over the /recents list, not the sidebar’s slice', () => {
    // Pins the click wiring end to end: the trigger must reach `openRecentsBulkExport`, which
    // enumerates through the adapter's recents members. `location` is what that lookup reads.
    const doc = docWithClaudeRecentsTable();
    vi.stubGlobal('location', { href: CLAUDE_RECENTS_URL, origin: 'https://claude.ai', pathname: '/recents' });
    syncButtons(doc, CLAUDE_RECENTS_URL);
    doc.getElementById(CONTAINER_ID)?.querySelector('button')?.click();

    const panel = doc.getElementById(BULK_PANEL_ID);
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('First recent');
    expect(panel?.textContent).toContain('Second recent');
  });

  it('mounts one container carrying the right track’s name across an SPA route change', () => {
    // The three tracks share `CONTAINER_ID`, so a route change is structural rather than
    // cosmetic. Driven exactly as the bootstrap does it (src/content/index.ts: on an href
    // change, drop the previous page's container, then sync), because that removal is what
    // keeps a stale track's trigger from being re-positioned into the new page's mount.
    const window = new Window({ url: CLAUDE_RECENTS_URL });
    window.document.write(
      `<body><header><div data-testid="${CLAUDE_ACTIONS_ID}">` +
        `<button data-testid="${CLAUDE_ACTIONS_ID}-share"></button></div></header>` +
        '<main><table data-cds="Table"><tbody><tr class="group/cdsrow"><td>' +
        '<a href="/chat/recent-1" aria-label="First recent">First recent</a>' +
        '</td></tr></tbody></table></main></body>',
    );
    const doc = window.document as unknown as Document;

    const step = (href: string): Element | null => {
      removeButtons(doc);
      syncButtons(doc, href);
      expect(doc.querySelectorAll(`#${CONTAINER_ID}`).length).toBe(1);
      return doc.getElementById(CONTAINER_ID);
    };

    // A conversation page gets the per-format toolbar in the header, not a list trigger.
    const conversation = step(CLAUDE_CONV_URL);
    expect(conversation?.parentElement?.getAttribute('data-testid')).toBe(CLAUDE_ACTIONS_ID);
    expect(conversation?.querySelectorAll('button').length).toBe(5);

    const recents = step(CLAUDE_RECENTS_URL);
    expect(recents?.parentElement?.tagName).toBe('MAIN');
    expect(recents?.querySelector('button')?.getAttribute('aria-label')).toBe('Download all recent conversations');

    const project = step(CLAUDE_PROJECT_URL);
    expect(project?.parentElement?.tagName).toBe('MAIN');
    expect(project?.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Download all conversations in this project',
    );
  });
});

describe('createRecentsTrigger', () => {
  it('builds a single labeled button wearing the provider class, with the recents bulk aria-label', () => {
    const container = createRecentsTrigger(bareDoc(), 'native', 'btn btn-secondary h-9 px-3');
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    // The accessible name is the only thing that distinguishes this trigger from the project
    // one; the visible label is deliberately shared.
    expect(buttons[0].getAttribute('aria-label')).toBe('Download all recent conversations');
    expect(buttons[0].getAttribute('title')).toBe('Download all recent conversations');
    expect(buttons[0].textContent).toContain('Download all');
    expect(buttons[0].querySelector('svg')).not.toBeNull();
    expect(buttons[0].className).toBe('btn btn-secondary h-9 px-3');
    expect(buttons[0].style.background).toBe('');
  });

  it('positions the overlay variant bottom-right so it never covers page chrome', () => {
    const container = createRecentsTrigger(bareDoc(), 'overlay');
    expect(container.style.position).toBe('fixed');
    expect(container.style.bottom).toBe('12px');
    expect(container.style.top).toBe('');
    expect(container.querySelector('button')?.style.background).toBe('#10a37f');
  });
});

describe('createProjectTrigger', () => {
  it('builds a single labeled button wearing the provider class, with the project bulk aria-label', () => {
    const container = createProjectTrigger(bareDoc(), 'native', 'btn btn-secondary h-9 px-3');
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].getAttribute('aria-label')).toBe('Download all conversations in this project');
    expect(buttons[0].getAttribute('title')).toBe('Download all conversations in this project');
    expect(buttons[0].textContent).toContain('Download all');
    expect(buttons[0].querySelector('svg')).not.toBeNull();
    // Native trigger wears the provider-supplied ChatGPT button classes (not a self-styled pill).
    expect(buttons[0].className).toBe('btn btn-secondary h-9 px-3');
    expect(buttons[0].style.background).toBe('');
  });

  it('positions the overlay variant bottom-right so it never covers page chrome', () => {
    const container = createProjectTrigger(bareDoc(), 'overlay');
    expect(container.style.position).toBe('fixed');
    expect(container.style.bottom).toBe('12px');
    expect(container.style.top).toBe('');
    // Overlay fallback stays self-styled (green pill) so it is legible without host CSS.
    expect(container.querySelector('button')?.style.background).toBe('#10a37f');
  });
});

describe('createButtons', () => {
  it('applies the provider-supplied button class and accessible names to native buttons', () => {
    const container = createButtons(bareDoc(), 'native', 'btn btn-ghost');
    const buttons = container.querySelectorAll('button');

    expect(buttons.length).toBe(5);
    expect(buttons[0].className).toBe('btn btn-ghost');
    expect(buttons[0].getAttribute('aria-label')).toBe('Download conversation as Markdown');
    expect(buttons[1].getAttribute('aria-label')).toBe('Download conversation as PDF');
    expect(buttons[2].getAttribute('aria-label')).toBe('Download conversation as JSON');
    expect(buttons[3].getAttribute('aria-label')).toBe('Download conversation as HTML');
    // The bulk action is the last button, after the per-format downloads.
    expect(buttons[4].getAttribute('aria-label')).toBe('Export multiple conversations');
  });

  it('renders icon-only native buttons with a tooltip title and no visible text label', () => {
    const container = createButtons(bareDoc(), 'native', 'icon-btn');
    const buttons = container.querySelectorAll('button');

    for (const button of buttons) {
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.textContent).toBe('');
    }
    // Title (hover tooltip) carries the meaning the visible label used to.
    expect(buttons[0].getAttribute('title')).toBe('Download conversation as Markdown');
    expect(buttons[1].getAttribute('title')).toBe('Download conversation as PDF');
    expect(buttons[2].getAttribute('title')).toBe('Download conversation as JSON');
    expect(buttons[3].getAttribute('title')).toBe('Download conversation as HTML');
    expect(buttons[4].getAttribute('title')).toBe('Export multiple conversations');
  });

  it('renders only the enabled format buttons plus the bulk button', () => {
    setToolbarSettings({ formats: { md: true, pdf: false, json: false, html: false }, bulk: true });
    const buttons = createButtons(bareDoc(), 'native', 'icon-btn').querySelectorAll('button');

    // Just the Markdown download + the bulk action.
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('aria-label')).toBe('Download conversation as Markdown');
    expect(buttons[1].getAttribute('aria-label')).toBe('Export multiple conversations');
  });

  it('omits the bulk button when the bulk icon is disabled', () => {
    setToolbarSettings({ formats: { md: true, pdf: true, json: true, html: true }, bulk: false });
    const buttons = createButtons(bareDoc(), 'native', 'icon-btn').querySelectorAll('button');

    // All four format downloads, no bulk.
    expect(buttons.length).toBe(4);
    expect(Array.from(buttons).some((b) => b.getAttribute('aria-label') === 'Export multiple conversations')).toBe(
      false,
    );
  });

  // A provider that does not implement the bulk track (Claude today) must not advertise it:
  // the icon would render on every one of its conversation pages and answer a click with
  // "not supported", which is worse than the feature being absent.
  it('omits the bulk button when the page’s adapter does not support bulk', () => {
    setToolbarSettings({ formats: { md: true, pdf: true, json: true, html: true }, bulk: true });
    const buttons = createButtons(bareDoc(), 'native', 'icon-btn', false).querySelectorAll('button');

    expect(buttons.length).toBe(4);
    expect(Array.from(buttons).some((b) => b.getAttribute('aria-label') === 'Export multiple conversations')).toBe(
      false,
    );
  });

  it('keeps the bulk button for an adapter that does support bulk', () => {
    setToolbarSettings({ formats: { md: true, pdf: true, json: true, html: true }, bulk: true });
    const buttons = createButtons(bareDoc(), 'native', 'icon-btn', true).querySelectorAll('button');

    expect(buttons.length).toBe(5);
    expect(buttons[4].getAttribute('aria-label')).toBe('Export multiple conversations');
  });
});

describe('setToolbarSettings', () => {
  it('reports whether the value actually changed so the caller can skip a needless re-mount', () => {
    // Baseline is the all-on default (restored by afterEach). Re-applying it is a no-op.
    expect(setToolbarSettings(DEFAULT_SETTINGS)).toBe(false);

    const custom = { formats: { md: true, pdf: false, json: true, html: true }, bulk: true };
    expect(setToolbarSettings(custom)).toBe(true); // differs from default → changed
    expect(setToolbarSettings({ formats: { ...custom.formats }, bulk: custom.bulk })).toBe(false); // equal value → no change
    expect(setToolbarSettings({ ...custom, bulk: false })).toBe(true); // bulk flip → changed
  });
});
