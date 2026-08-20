import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { geminiAdapter } from '../../../src/adapters/gemini';

// Load the Gemini fixture, whose top bar reproduces the live structure captured on
// 2026-07-25 (see the fixture's own header comment).
function loadFixture(name: string): Document {
  const path = fileURLToPath(new URL(`../../fixtures/gemini/${name}`, import.meta.url));
  const window = new Window();
  window.document.write(readFileSync(path, 'utf-8'));
  return window.document as unknown as Document;
}

function bareDoc(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

describe('geminiAdapter.toolbarMount', () => {
  it('returns the header’s right-hand action group', () => {
    const mount = geminiAdapter.toolbarMount?.(loadFixture('short.html')) ?? null;
    expect(mount).not.toBeNull();
    expect(mount?.getAttribute('class')).toBe('right-section');
  });

  it('locates the group that contains the native controls (so we mount beside them)', () => {
    const mount = geminiAdapter.toolbarMount?.(loadFixture('short.html')) ?? null;
    expect(mount?.querySelector('tts-control-v2')).not.toBeNull();
  });

  it('does not resolve the left or centre sections, which hold no controls', () => {
    // All three sections are siblings with equally generic class names, so a selector that
    // drifted to the first one would still return an element and mount the buttons nowhere
    // visible.
    const mount = geminiAdapter.toolbarMount?.(loadFixture('short.html')) ?? null;
    expect(mount?.previousElementSibling?.getAttribute('class')).toBe('center-section');
  });

  it('returns null when the header bar is absent (markup change / not yet rendered)', () => {
    const mount = geminiAdapter.toolbarMount?.(bareDoc('<main>no header here</main>')) ?? null;
    expect(mount).toBeNull();
  });

  it('does not match a right-section outside the top bar', () => {
    // `div.right-section` on its own is a generic layout class; the selector is anchored to
    // `top-bar-actions` so an unrelated layout column cannot capture the export buttons.
    const mount =
      geminiAdapter.toolbarMount?.(bareDoc('<main><div class="right-section"></div></main>')) ?? null;
    expect(mount).toBeNull();
  });
});

describe('geminiAdapter.toolbarAnchor', () => {
  it('resolves to the native text-to-speech control (the export buttons mount to its left)', () => {
    // Gemini has no Share button, so this is the leftmost native control in the group.
    const anchor = geminiAdapter.toolbarAnchor?.(loadFixture('short.html')) ?? null;
    expect(anchor?.tagName.toLowerCase()).toBe('tts-control-v2');
  });

  it('sits inside the mount, so the content layer can insert ahead of it', () => {
    const doc = loadFixture('short.html');
    const mount = geminiAdapter.toolbarMount?.(doc) ?? null;
    const anchor = geminiAdapter.toolbarAnchor?.(doc) ?? null;
    expect(anchor).not.toBeNull();
    expect(mount?.contains(anchor as Node)).toBe(true);
  });

  it('returns null when the control is absent', () => {
    const anchor = geminiAdapter.toolbarAnchor?.(bareDoc('<main>no header here</main>')) ?? null;
    expect(anchor).toBeNull();
  });
});

// The class string the export buttons wear is a *captured live value*, and nothing about it
// is type-checked — an embellished token would look identical in review and only show up as
// unstyled buttons on the real page (AGENTS.md #5). These tests pin it to the fixture's own
// text-to-speech button, which reproduces the 2026-07-25 capture in full.
describe('geminiAdapter.toolbarButtonClass', () => {
  function ttsButtonClasses(): Set<string> {
    const button = loadFixture('short.html').querySelector('tts-control-v2 button');
    return new Set((button?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
  }

  it('uses only tokens that Gemini’s own header button actually carries', () => {
    const native = ttsButtonClasses();
    const used = (geminiAdapter.toolbarButtonClass ?? '').split(/\s+/).filter(Boolean);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((token) => !native.has(token))).toEqual([]);
  });

  it('drops only the tokens that are wrong for a button we inserted ourselves', () => {
    const used = new Set((geminiAdapter.toolbarButtonClass ?? '').split(/\s+/).filter(Boolean));
    const native = ttsButtonClasses();
    // Each is present on the native button, so excluding it is a deliberate choice, not an
    // omission: `tts-button` is the speech control's own identity, `mat-mdc-tooltip-trigger`
    // claims an Angular Material directive these buttons do not use, and `ng-star-inserted`
    // marks nodes the framework created.
    for (const token of ['tts-button', 'mat-mdc-tooltip-trigger', 'ng-star-inserted']) {
      expect(native.has(token)).toBe(true);
      expect(used.has(token)).toBe(false);
    }
  });

  it('keeps the Material base tokens that carry the disabled-state styling', () => {
    // `runExport` disables every button for the whole export, and on Gemini that is a
    // multi-second scroll walk — the native styling is the only in-flight feedback.
    const used = new Set((geminiAdapter.toolbarButtonClass ?? '').split(/\s+/).filter(Boolean));
    for (const token of ['mdc-icon-button', 'mat-mdc-icon-button', 'mat-mdc-button-base']) {
      expect(used.has(token)).toBe(true);
    }
  });
});

describe('geminiAdapter shape', () => {
  it('implements only the members its live verification covers', () => {
    // The sidebar bulk track is verified (docs/live-dom-verification.md → 2026-08-10: the
    // sidebar pages at 20, append-only, 1:1 anchor identity), so its three members are present.
    // The Notebooks/project track is NOT — the measuring account had zero notebooks — so its
    // members stay absent, and the content layer reads that absence to hide the project trigger
    // (see `pickProjectAdapter` in `src/content/mount.ts`). Asserting the member set whole
    // catches a member added later without the live verification that must come with it.
    expect(geminiAdapter.provider).toBe('gemini');
    expect(Object.keys(geminiAdapter).sort()).toEqual([
      'extract',
      'listConversations',
      'loadMoreConversations',
      'matches',
      'openConversation',
      'provider',
      'toolbarAnchor',
      'toolbarButtonClass',
      'toolbarMount',
    ]);
  });
});
