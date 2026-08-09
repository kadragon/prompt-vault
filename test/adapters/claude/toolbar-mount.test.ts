import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { claudeAdapter } from '../../../src/adapters/claude';

// Load the Claude fixture, whose header block reproduces the live structure captured on
// 2026-07-25 (see the fixture's own header comment).
function loadFixture(name: string): Document {
  const path = fileURLToPath(new URL(`../../fixtures/claude/${name}`, import.meta.url));
  const window = new Window();
  window.document.write(readFileSync(path, 'utf-8'));
  return window.document as unknown as Document;
}

function bareDoc(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

describe('claudeAdapter.toolbarMount', () => {
  it('returns the header action bar', () => {
    const mount = claudeAdapter.toolbarMount?.(loadFixture('short.html')) ?? null;
    expect(mount).not.toBeNull();
    expect(mount?.getAttribute('data-testid')).toBe('wiggle-controls-actions');
  });

  it('locates the bar that contains the native Share button (so we mount beside it)', () => {
    const mount = claudeAdapter.toolbarMount?.(loadFixture('short.html')) ?? null;
    expect(mount?.querySelector('[data-testid="wiggle-controls-actions-share"]')).not.toBeNull();
  });

  it('returns null when the header bar is absent (markup change / not yet rendered)', () => {
    const mount = claudeAdapter.toolbarMount?.(bareDoc('<main>no header here</main>')) ?? null;
    expect(mount).toBeNull();
  });
});

describe('claudeAdapter.toolbarAnchor', () => {
  it('resolves to the native Share button (the export buttons mount to its left)', () => {
    const anchor = claudeAdapter.toolbarAnchor?.(loadFixture('short.html')) ?? null;
    expect(anchor?.getAttribute('data-testid')).toBe('wiggle-controls-actions-share');
  });

  it('returns null when the Share button is absent', () => {
    const anchor = claudeAdapter.toolbarAnchor?.(bareDoc('<main>no header here</main>')) ?? null;
    expect(anchor).toBeNull();
  });
});

// The class string the export buttons wear is a *captured live value*, and nothing about
// it is type-checked — an embellished token would look identical in review and only show
// up as unstyled buttons on the real page (AGENTS.md #5). These tests pin it to the
// fixture's own Share button, which reproduces the 2026-07-25 capture in full.
describe('claudeAdapter.toolbarButtonClass', () => {
  function shareButtonClasses(): Set<string> {
    const share = loadFixture('short.html').querySelector(
      '[data-testid="wiggle-controls-actions-share"]',
    );
    return new Set((share?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
  }

  it('uses only tokens that Claude’s own header button actually carries', () => {
    const native = shareButtonClasses();
    const used = (claudeAdapter.toolbarButtonClass ?? '').split(/\s+/).filter(Boolean);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((token) => !native.has(token))).toEqual([]);
  });

  it('drops only the tokens that are wrong for an icon-only, non-toggle button', () => {
    const used = new Set((claudeAdapter.toolbarButtonClass ?? '').split(/\s+/).filter(Boolean));
    const native = shareButtonClasses();
    // `px-md` pads a *labeled* control; `aria-pressed:` styles a toggle. Both are present on
    // the native button, so excluding them is a deliberate choice, not an omission.
    for (const token of ['px-md', 'aria-pressed:text-accent']) {
      expect(native.has(token)).toBe(true);
      expect(used.has(token)).toBe(false);
    }
  });

  it('keeps the disabled-state tokens, which are the only in-flight export feedback', () => {
    // `runExport` disables every button for the whole export, and on Claude that is a
    // multi-second scroll walk. Dropping these as "variants that never apply" was wrong.
    const used = new Set((claudeAdapter.toolbarButtonClass ?? '').split(/\s+/).filter(Boolean));
    for (const token of [
      'disabled:pointer-events-none',
      '[&:disabled:not([aria-busy])]:opacity-50',
      'cursor-[var(--cds-cursor-interactive)]',
    ]) {
      expect(used.has(token)).toBe(true);
    }
  });
});

describe('claudeAdapter shape', () => {
  it('implements the measured conversation, sidebar, and project members', () => {
    // The whole member set catches a navigation method added without the live verification
    // and keeps the optional generic UI gates coupled to the provider contract.
    expect(claudeAdapter.provider).toBe('claude');
    expect(Object.keys(claudeAdapter).sort()).toEqual([
      'extract',
      'listConversations',
      'listProjectConversations',
      'loadMoreConversations',
      'matches',
      'matchesProject',
      'openConversation',
      'openProjectConversation',
      'openProjectHome',
      'projectToolbarMount',
      'provider',
      'toolbarAnchor',
      'toolbarButtonClass',
      'toolbarMount',
    ]);
  });
});
