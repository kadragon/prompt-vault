import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  bytesToBase64,
  JETENDARD_BOLD_VFS_KEY,
  JETENDARD_VFS_KEY,
  loadJetendardVfs,
} from '../../src/export/fonts/jetendard';
import { ExtractionError } from '../../src/core/errors';

// The loader reads the faces over `chrome.runtime.getURL`, so both that and `fetch`
// are stubbed here. Only `chrome.i18n` is set up globally (test/setup/chrome-i18n.ts),
// and the node environment has no extension APIs at all.
function stubChromeRuntime(): void {
  const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> };
  chromeGlobal.chrome = {
    ...chromeGlobal.chrome,
    runtime: { getURL: (path: string) => `chrome-extension://test-id/${path}` },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bytesToBase64', () => {
  it('round-trips bytes through the base64 pdfmake expects', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('round-trips a payload larger than one chunk', () => {
    // The chunking exists because a single `String.fromCharCode(...bytes)` spread
    // throws RangeError on a 4.6 MB face. This asserts the seam between chunks is
    // joined correctly, which a small payload would never reach.
    const bytes = new Uint8Array(0x8000 * 2 + 7);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('encodes a real font face byte-for-byte', () => {
    // End to end against the file that actually ships: a corrupted face would be a
    // PDF full of tofu boxes, which is exactly the failure this sprint is closing.
    const face = readFileSync(
      fileURLToPath(new URL('../../public/fonts/Jetendard-Regular.ttf', import.meta.url)),
    );
    expect(bytesToBase64(new Uint8Array(face))).toBe(face.toString('base64'));
  });
});

describe('loadJetendardVfs', () => {
  it('reads both faces from the extension package, keyed for pdfmake', async () => {
    stubChromeRuntime();
    const requested: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      requested.push(url);
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) });
    });

    const vfs = await loadJetendardVfs();

    // Never a remote origin (Golden Principle #1) — the only URL shape allowed is the
    // extension's own package.
    expect(requested.sort()).toEqual([
      'chrome-extension://test-id/fonts/Jetendard-Bold.ttf',
      'chrome-extension://test-id/fonts/Jetendard-Regular.ttf',
    ]);
    expect(Object.keys(vfs).sort()).toEqual([JETENDARD_BOLD_VFS_KEY, JETENDARD_VFS_KEY].sort());
    expect(vfs[JETENDARD_VFS_KEY]).toBe(Buffer.from([1, 2, 3]).toString('base64'));
  });

  it('fails loud on a non-OK response', async () => {
    // Without this, pdfmake would fall back to a face with no Hangul or CJK coverage
    // and render a whole page of tofu boxes with no error at all (AGENTS.md #4).
    stubChromeRuntime();
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 }));

    await expect(loadJetendardVfs()).rejects.toBeInstanceOf(ExtractionError);
  });

  it('fails loud when the fetch itself rejects', async () => {
    stubChromeRuntime();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network error')));

    const error = await loadJetendardVfs().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionError);
    // The user-facing message is deliberately non-technical, so the original failure
    // rides along as `cause` rather than being swallowed.
    expect((error as ExtractionError).cause).toBeInstanceOf(Error);
  });
});
