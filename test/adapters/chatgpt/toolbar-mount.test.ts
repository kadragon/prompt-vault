import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { chatgptAdapter } from '../../../src/adapters/chatgpt';

// Load a captured fixture into a parsed document — the same real ChatGPT markup the
// extraction tests use, which includes the header bar and native Share button.
function loadFixture(name: string): Document {
  const path = fileURLToPath(new URL(`../../fixtures/chatgpt/${name}`, import.meta.url));
  const window = new Window();
  window.document.write(readFileSync(path, 'utf-8'));
  return window.document as unknown as Document;
}

function bareDoc(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

describe('chatgptAdapter.toolbarMount', () => {
  it('returns the header action bar from a real captured conversation', () => {
    const mount = chatgptAdapter.toolbarMount?.(loadFixture('short.html')) ?? null;
    expect(mount).not.toBeNull();
    expect(mount?.classList.contains('gap-toolbar-action')).toBe(true);
    expect(mount?.closest('header')).not.toBeNull();
  });

  it('locates the bar holding the native Share and options buttons (so we mount beside them)', () => {
    const mount = chatgptAdapter.toolbarMount?.(loadFixture('short.html')) ?? null;
    expect(mount?.querySelectorAll(':scope > button').length).toBe(2);
    expect(mount?.querySelector(':scope > button[aria-haspopup]')).not.toBeNull();
  });

  it('returns null when the header bar is absent (markup change / not yet rendered)', () => {
    const mount = chatgptAdapter.toolbarMount?.(bareDoc('<main>no header here</main>')) ?? null;
    expect(mount).toBeNull();
  });

  it('returns null on a page with no conversation header (new chat)', () => {
    expect(chatgptAdapter.toolbarMount?.(loadFixture('empty.html')) ?? null).toBeNull();
  });
});

describe('chatgptAdapter.toolbarAnchor', () => {
  it('resolves to the native Share button — the bar button that opens no menu', () => {
    const mount = chatgptAdapter.toolbarMount!(loadFixture('short.html'))!;
    const anchor = chatgptAdapter.toolbarAnchor?.(mount) ?? null;
    expect(anchor).toBe(mount.firstElementChild);
    expect(anchor?.hasAttribute('aria-haspopup')).toBe(false);
  });

  it('does not depend on the localized Share label', () => {
    const doc = bareDoc(
      '<div class="gap-toolbar-action"><button aria-label="Share"></button><button aria-haspopup="menu"></button></div>',
    );
    const bar = doc.querySelector('.gap-toolbar-action')!;
    expect(chatgptAdapter.toolbarAnchor?.(bar)).toBe(bar.firstElementChild);
  });

  it('never resolves to an export button injected into the bar', () => {
    // The content layer inserts its own container of buttons before Share; the anchor query
    // runs again on every sync and must still land on Share, not on one of ours.
    const mount = chatgptAdapter.toolbarMount!(loadFixture('short.html'))!;
    const share = chatgptAdapter.toolbarAnchor!(mount)!;
    const ours = mount.ownerDocument.createElement('div');
    ours.innerHTML = '<button>MD</button><button>PDF</button>';
    mount.insertBefore(ours, share);
    expect(chatgptAdapter.toolbarAnchor?.(mount)).toBe(share);
  });

  it('returns null when the Share button is absent', () => {
    const doc = bareDoc('<div class="gap-toolbar-action"><button aria-haspopup="menu"></button></div>');
    expect(chatgptAdapter.toolbarAnchor?.(doc.querySelector('.gap-toolbar-action')!) ?? null).toBeNull();
  });
});
