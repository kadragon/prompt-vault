import { afterEach, describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import type { Conversation } from '../../src/core/conversation';
import { conversation as makeConversation } from '../fixtures/conversation';
import { openSharePanel, SHARE_PANEL_ID } from '../../src/content/share-panel';
import { EXPORT_FAILED_MESSAGE, SHARE_PANEL_NO_CANDIDATES, SHARE_PANEL_WARNING } from '../../src/strings';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NOW = new Date(2026, 9, 27, 9, 30);

const CONV: Conversation = makeConversation({
  title: 'Acme escalation',
  url: 'https://chatgpt.com/c/secret',
  createdAt: '2026-10-27T00:00:00Z',
  messages: [
    { role: 'user', content: 'Mail jane@acme.test or call 010-1234-5678.', id: 'm1' },
    { role: 'assistant', content: 'Acme will reply.', id: 'm2' },
  ],
});

function freshDoc(): { doc: Document; window: Window } {
  const window = new Window();
  window.document.write('<body><button id="host">host</button></body>');
  return { doc: window.document as unknown as Document, window };
}

function open(conversation: Conversation = CONV) {
  const { doc, window } = freshDoc();
  const download = vi.fn();
  openSharePanel(doc, { conversation, download, now: NOW });
  return { doc, window, download };
}

function panelOf(doc: Document): HTMLElement {
  const panel = doc.getElementById(SHARE_PANEL_ID);
  if (!panel) throw new Error('panel not mounted');
  return panel;
}

function preview(doc: Document): string {
  return panelOf(doc).querySelector('pre')?.textContent ?? '';
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text);
  if (!button) throw new Error(`no button "${text}"`);
  return button;
}

function candidateBoxes(doc: Document): HTMLInputElement[] {
  return Array.from(panelOf(doc).querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
}

function termInput(doc: Document): HTMLInputElement {
  const input = panelOf(doc).querySelector<HTMLInputElement>('input[type="text"]');
  if (!input) throw new Error('no term input');
  return input;
}

function event<T extends Event>(doc: Document, type: 'Event' | 'KeyboardEvent' | 'MouseEvent', name: string, init?: object): T {
  const ctor = (doc.defaultView as unknown as Record<string, new (n: string, i?: object) => T>)[type];
  return new ctor(name, { bubbles: true, ...init });
}

function uncheck(box: HTMLInputElement): void {
  box.checked = false;
  box.dispatchEvent(event(box.ownerDocument, 'Event', 'change'));
}

function addTerm(doc: Document, term: string): void {
  termInput(doc).value = term;
  buttonByText(panelOf(doc), 'Add').click();
}

describe('openSharePanel', () => {
  it('mounts a labeled modal, describes it with the warning, and takes focus', () => {
    const { doc } = open();
    const panel = panelOf(doc);
    const dialog = panel.querySelector('[role="dialog"]')!;

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Markdown copy for sharing');
    const warning = doc.getElementById(dialog.getAttribute('aria-describedby')!);
    expect(warning?.textContent).toBe(SHARE_PANEL_WARNING);
    expect(doc.activeElement).toBe(dialog);
  });

  it('opens at most once', () => {
    const { doc, download } = open();
    openSharePanel(doc, { conversation: CONV, download, now: NOW });
    expect(doc.querySelectorAll(`#${SHARE_PANEL_ID}`)).toHaveLength(1);
  });

  it('lists every detected candidate checked by default, with its kind, and masks them in the preview', () => {
    const { doc } = open();
    const boxes = candidateBoxes(doc);

    expect(boxes.map((b) => b.checked)).toEqual([true, true]);
    expect(boxes.map((b) => b.closest('label')?.textContent)).toEqual(['Emailjane@acme.test', 'Phone010-1234-5678']);
    expect(preview(doc)).toBe(
      '# Shared conversation\n\n## User\n\nMail [EMAIL] or call [PHONE].\n\n## Assistant\n\nAcme will reply.\n',
    );
  });

  it('gives each checkbox its own native rendering and size, so host CSS cannot hide it', () => {
    const { doc } = open();
    for (const box of candidateBoxes(doc)) {
      expect(box.style.appearance).toBe('auto');
      expect(box.style.width).toBe('16px');
      expect(box.style.height).toBe('16px');
    }
  });

  it('says so when nothing was detected, and still previews the copy', () => {
    const { doc } = open(makeConversation({ messages: [{ role: 'user', content: 'Nothing personal.' }] }));

    expect(candidateBoxes(doc)).toHaveLength(0);
    expect(panelOf(doc).textContent).toContain(SHARE_PANEL_NO_CANDIDATES);
    // Nothing to uncheck, so the checklist heading that says to uncheck is not shown.
    expect(panelOf(doc).querySelector('legend')).toBeNull();
    expect(preview(doc)).toContain('Nothing personal.');
  });

  it('keeps an unchecked candidate in the preview, and masks it again when rechecked', () => {
    const { doc } = open();
    const [email] = candidateBoxes(doc);

    uncheck(email);
    expect(preview(doc)).toContain('Mail jane@acme.test or call [PHONE].');

    email.checked = true;
    email.dispatchEvent(event(doc, 'Event', 'change'));
    expect(preview(doc)).toContain('Mail [EMAIL] or call [PHONE].');
  });

  it('masks an added term (button or Enter) and unmasks it when the term is removed', () => {
    const { doc } = open();

    addTerm(doc, 'Acme');
    expect(preview(doc)).toContain('[REDACTED] will reply.');
    expect(termInput(doc).value).toBe('');

    termInput(doc).value = 'reply';
    termInput(doc).dispatchEvent(event(doc, 'KeyboardEvent', 'keydown', { key: 'Enter' }));
    expect(preview(doc)).toContain('[REDACTED] will [REDACTED].');

    buttonByText(panelOf(doc), '×').click(); // removes the first term, "Acme"
    expect(preview(doc)).toContain('Acme will [REDACTED].');
    expect(panelOf(doc).querySelector('[aria-label="Remove reply"]')).not.toBeNull();
  });

  it('ignores a blank or repeated term, and an Enter that only confirms an IME composition', () => {
    const { doc } = open();
    addTerm(doc, '   ');
    addTerm(doc, 'Acme');
    addTerm(doc, 'Acme');
    expect(panelOf(doc).querySelectorAll('li')).toHaveLength(1);

    termInput(doc).value = '제인';
    termInput(doc).dispatchEvent(event(doc, 'KeyboardEvent', 'keydown', { key: 'Enter', isComposing: true }));
    expect(panelOf(doc).querySelectorAll('li')).toHaveLength(1);
    expect(termInput(doc).value).toBe('제인');
  });

  it('saves exactly the previewed text under the share filename, then closes', () => {
    const { doc, download } = open();
    uncheck(candidateBoxes(doc)[1]);
    addTerm(doc, 'Acme');
    const shown = preview(doc);

    buttonByText(panelOf(doc), 'Save copy').click();

    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith('chatgpt-shared-20261027.md', shown);
    expect(shown).toContain('010-1234-5678');
    expect(shown).not.toContain('jane@acme.test');
    expect(doc.getElementById(SHARE_PANEL_ID)).toBeNull();
  });

  it('alerts and keeps the modal open with its choices when the download throws', () => {
    const alerts = vi.fn();
    vi.stubGlobal('alert', alerts);
    const { doc } = freshDoc();
    const download = vi.fn(() => {
      throw new Error('blob failed');
    });
    openSharePanel(doc, { conversation: CONV, download, now: NOW });
    addTerm(doc, 'Acme');

    buttonByText(panelOf(doc), 'Save copy').click();

    expect(alerts).toHaveBeenCalledWith(EXPORT_FAILED_MESSAGE);
    expect(doc.getElementById(SHARE_PANEL_ID)).not.toBeNull();
    expect(panelOf(doc).querySelectorAll('li')).toHaveLength(1);
  });

  it('never mutates the conversation it was handed', () => {
    const before = structuredClone(CONV);
    const { doc } = open();
    uncheck(candidateBoxes(doc)[0]);
    addTerm(doc, 'Acme');
    buttonByText(panelOf(doc), 'Save copy').click();
    expect(CONV).toEqual(before);
  });

  describe.each([
    ['Cancel', (doc: Document) => buttonByText(panelOf(doc), 'Cancel').click()],
    ['Escape', (doc: Document) => doc.dispatchEvent(event(doc, 'KeyboardEvent', 'keydown', { key: 'Escape' }))],
    ['a backdrop click', (doc: Document) => panelOf(doc).click()],
  ])('closing via %s', (_label, dismiss) => {
    it('removes the panel without saving and unbinds the document keydown listener it bound', () => {
      const { doc, download } = open();
      const removed = vi.spyOn(doc, 'removeEventListener');
      const added = vi.spyOn(doc, 'addEventListener');

      dismiss(doc);

      expect(doc.getElementById(SHARE_PANEL_ID)).toBeNull();
      expect(download).not.toHaveBeenCalled();
      expect(removed).toHaveBeenCalledWith('keydown', expect.any(Function));
      // Reopen and close again: had the first listener survived, a later Escape would run its
      // close() on the detached first panel; instead the second panel's own listener closes it.
      openSharePanel(doc, { conversation: CONV, download, now: NOW });
      const [, secondListener] = added.mock.calls.find(([type]) => type === 'keydown')!;
      doc.dispatchEvent(event(doc, 'KeyboardEvent', 'keydown', { key: 'Escape' }));
      expect(doc.getElementById(SHARE_PANEL_ID)).toBeNull();
      expect(removed).toHaveBeenLastCalledWith('keydown', secondListener);
    });
  });

  it('does not close on a click inside the dialog', () => {
    const { doc } = open();
    (panelOf(doc).querySelector('[role="dialog"]') as HTMLElement).click();
    expect(doc.getElementById(SHARE_PANEL_ID)).not.toBeNull();
  });

  it('writes nothing to chrome.storage or localStorage across a full review', () => {
    const storage = {
      sync: { set: vi.fn(), get: vi.fn() },
      local: { set: vi.fn(), get: vi.fn() },
      session: { set: vi.fn(), get: vi.fn() },
    };
    vi.stubGlobal('chrome', { ...(globalThis as unknown as { chrome: object }).chrome, storage });
    const { doc, window } = open();
    const setItem = vi.spyOn(window.localStorage, 'setItem');

    uncheck(candidateBoxes(doc)[0]);
    addTerm(doc, 'Acme');
    buttonByText(panelOf(doc), 'Save copy').click();

    expect(storage.sync.set).not.toHaveBeenCalled();
    expect(storage.local.set).not.toHaveBeenCalled();
    expect(storage.session.set).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
