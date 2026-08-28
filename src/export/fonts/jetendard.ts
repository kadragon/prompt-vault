// Jetendard Regular and Bold (JetBrains Mono + Pretendard, monospace, SIL OFL 1.1 —
// see OFL.txt in this directory) as base64 strings for pdfmake's virtual file system.
// Two weights, not one: pdfmake renders `bold: true` runs with whatever file fills the
// font's bold slot, so pointing that slot at Regular (as this module did while the PDF
// carried no Markdown styling) silently drops every `**strong**` run's emphasis.
//
// The font is embedded, not fetched: content scripts must not make network calls
// (Golden Principle #1), and a PDF needs its font bytes embedded anyway. Vite's
// `?inline` inlines the .ttf as a base64 `data:` URL at build time; we strip the
// `data:...;base64,` prefix to hand pdfmake the raw base64 it expects. This module
// is data only (no DOM) and is loaded lazily — only via src/content/pdf-download.ts,
// which the button reaches through a dynamic import on the PDF action.

import jetendardDataUrl from './Jetendard-Regular.ttf?inline';
import jetendardBoldDataUrl from './Jetendard-Bold.ttf?inline';

/** Filename keys used in both `pdfMake.addVirtualFileSystem` and `pdfMake.addFonts`. */
export const JETENDARD_VFS_KEY = 'Jetendard-Regular.ttf';
export const JETENDARD_BOLD_VFS_KEY = 'Jetendard-Bold.ttf';

/** Raw base64 of each face (no `data:` URL prefix), for pdfmake's vfs. */
export const JETENDARD_REGULAR_B64 = jetendardDataUrl.slice(jetendardDataUrl.indexOf(',') + 1);
export const JETENDARD_BOLD_B64 = jetendardBoldDataUrl.slice(
  jetendardBoldDataUrl.indexOf(',') + 1,
);
