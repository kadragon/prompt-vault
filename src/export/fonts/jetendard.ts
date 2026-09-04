// Jetendard Regular and Bold (JetBrains Mono + Pretendard, monospace, SIL OFL 1.1 —
// see public/fonts/OFL.txt) loaded for pdfmake's virtual file system.
// Two weights, not one: pdfmake renders `bold: true` runs with whatever file fills the
// font's bold slot, so pointing that slot at Regular (as this module did while the PDF
// carried no Markdown styling) silently drops every `**strong**` run's emphasis.
//
// The faces ship INSIDE the extension and are read from it — never fetched from a
// network origin (Golden Principle #1), and a PDF needs its font bytes embedded
// anyway. They used to arrive through Vite's `?inline`, which turns each 4.6 MB .ttf
// into base64 inside a JS module: the lazily-imported PDF chunk measured 13,399 kB
// (gzip 6.29 MB) on PR #77, so every export parsed ~13 MB of script and decoded ~6 MB
// of base64 before the first PDF byte. Now the .ttf files sit in `public/fonts/`
// (copied verbatim into `dist/`, so the path carries no content hash) and are read at
// export time over a `chrome-extension://` URL from `chrome.runtime.getURL`, declared
// in `web_accessible_resources` scoped to the three supported hosts.
//
// This is the ONE `fetch(` allowed under `src/`, and only in the
// `fetch(chrome.runtime.getURL(...))` shape — a same-package URL that cannot
// exfiltrate. `test/privacy/no-external-network.test.ts` pins both the shape and this
// file as the sole call site.
//
// This module has no DOM dependency and is loaded lazily — only via
// src/content/pdf-download.ts, which the button reaches through a dynamic import on
// the PDF action.

import { ExtractionError } from '../../core/errors';
import { PDF_FONT_LOAD_FAILED_MESSAGE } from '../../strings';

/** Filename keys used in both `pdfMake.addVirtualFileSystem` and `pdfMake.addFonts`. */
export const JETENDARD_VFS_KEY = 'Jetendard-Regular.ttf';
export const JETENDARD_BOLD_VFS_KEY = 'Jetendard-Bold.ttf';

/** Extension-relative paths of the two faces, as copied from `public/` into `dist/`. */
const FACE_PATHS: Readonly<Record<string, string>> = {
  [JETENDARD_VFS_KEY]: 'fonts/Jetendard-Regular.ttf',
  [JETENDARD_BOLD_VFS_KEY]: 'fonts/Jetendard-Bold.ttf',
};

// btoa() takes a binary string, and building one with a single
// `String.fromCharCode(...bytes)` spread blows the argument limit on a 4.6 MB face
// (RangeError). Chunk it instead; 32 KiB is comfortably under every engine's limit.
const BASE64_CHUNK_BYTES = 0x8000;

/**
 * Encode raw font bytes as the base64 string pdfmake's virtual file system expects
 * (`TVirtualFileSystem` maps a path to base64 content, not to bytes).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

/**
 * Read both faces out of the extension package and return them keyed by the VFS names
 * `pdfMake.addFonts` references.
 *
 * Fails loud (AGENTS.md #4): a missing or unreadable face would otherwise let pdfmake
 * fall back to a face with no Hangul or CJK coverage, producing a full page of tofu
 * boxes with no error. Every failure — a rejected fetch, a non-OK response, a decode
 * error — becomes one `ExtractionError` the content layer already knows how to show.
 */
export async function loadJetendardVfs(): Promise<Record<string, string>> {
  try {
    const entries = await Promise.all(
      Object.entries(FACE_PATHS).map(async ([vfsKey, path]) => {
        const response = await fetch(chrome.runtime.getURL(path));
        if (!response.ok) {
          throw new Error(`${path}: HTTP ${response.status}`);
        }
        return [vfsKey, bytesToBase64(new Uint8Array(await response.arrayBuffer()))] as const;
      }),
    );
    return Object.fromEntries(entries);
  } catch (cause) {
    throw new ExtractionError(PDF_FONT_LOAD_FAILED_MESSAGE, { cause });
  }
}
