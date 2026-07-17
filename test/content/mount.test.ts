import { afterEach, describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { CONTAINER_ID, createButtons, setToolbarSettings, syncButtons } from '../../src/content/mount';
import { DEFAULT_SETTINGS } from '../../src/settings/store';

// setToolbarSettings mutates module state; reset to the all-on default after every test so
// the filtering cases below never leak into the syncButtons tests that assume a full toolbar.
afterEach(() => setToolbarSettings(DEFAULT_SETTINGS));

const CONV_URL = 'https://chatgpt.com/c/abc-123';
const NON_CONV_URL = 'https://chatgpt.com/';
const HEADER_ID = 'conversation-header-actions';

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
