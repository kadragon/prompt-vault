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
    expect(mount?.id).toBe('conversation-header-actions');
  });

  it('locates the bar that contains the native Share button (so we mount beside it)', () => {
    const mount = chatgptAdapter.toolbarMount?.(loadFixture('short.html')) ?? null;
    expect(mount?.querySelector('[data-testid="share-chat-button"]')).not.toBeNull();
  });

  it('returns null when the header bar is absent (markup change / not yet rendered)', () => {
    const mount = chatgptAdapter.toolbarMount?.(bareDoc('<main>no header here</main>')) ?? null;
    expect(mount).toBeNull();
  });
});

describe('chatgptAdapter.toolbarAnchor', () => {
  it('resolves to the native Share button (the export buttons mount to its left)', () => {
    const anchor = chatgptAdapter.toolbarAnchor?.(loadFixture('short.html')) ?? null;
    expect(anchor?.getAttribute('data-testid')).toBe('share-chat-button');
  });

  it('returns null when the Share button is absent', () => {
    const anchor = chatgptAdapter.toolbarAnchor?.(bareDoc('<main>no header here</main>')) ?? null;
    expect(anchor).toBeNull();
  });
});
