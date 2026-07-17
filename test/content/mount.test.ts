import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { CONTAINER_ID, createButtons, syncButtons } from '../../src/content/mount';

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
    expect(container?.querySelectorAll('button').length).toBe(2);
  });

  it('is idempotent — repeated calls do not duplicate the buttons', () => {
    const doc = docWithHeader();
    syncButtons(doc, CONV_URL);
    syncButtons(doc, CONV_URL);
    syncButtons(doc, CONV_URL);

    const header = doc.getElementById(HEADER_ID);
    // 2 export buttons + the fixture's Share button.
    expect(header?.querySelectorAll('button').length).toBe(3);
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
});

describe('createButtons', () => {
  it('builds native buttons that reuse ChatGPT classes and carry accessible names', () => {
    const container = createButtons(bareDoc(), 'native');
    const buttons = container.querySelectorAll('button');

    expect(buttons.length).toBe(2);
    expect(buttons[0].className).toContain('btn');
    expect(buttons[0].getAttribute('aria-label')).toBe('Download conversation as Markdown');
    expect(buttons[1].getAttribute('aria-label')).toBe('Download conversation as PDF');
  });
});
