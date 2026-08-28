// Runtime PDF generation + download. This module is the DOM/browser-facing half of
// the PDF exporter: it pulls in pdfmake and the embedded font (both heavy) and is
// reached ONLY through a dynamic `import()` from src/content/index.ts on the PDF
// button action, so @crxjs code-splits pdfmake + the font into a separate chunk
// that never loads on an ordinary page visit.
//
// No network primitive here (Golden Principle #1): the font is embedded as base64
// and pdfmake's `.download()` builds the file locally via a blob URL internally.

import pdfMake from 'pdfmake/build/pdfmake';
import type { TFontDictionary } from 'pdfmake/interfaces';
import {
  JETENDARD_BOLD_B64,
  JETENDARD_BOLD_VFS_KEY,
  JETENDARD_REGULAR_B64,
  JETENDARD_VFS_KEY,
} from '../export/fonts/jetendard';
import { PDF_FONT, pdfFilename, toPdfDocDefinition } from '../export/pdf';
import type { Conversation } from '../core/conversation';

// Register the embedded font once per page. pdfmake accumulates vfs/font entries
// globally, so guard against re-registering on repeated PDF exports.
let fontsRegistered = false;

function registerFonts(): void {
  if (fontsRegistered) return;
  pdfMake.addVirtualFileSystem({
    [JETENDARD_VFS_KEY]: JETENDARD_REGULAR_B64,
    [JETENDARD_BOLD_VFS_KEY]: JETENDARD_BOLD_B64,
  });
  // pdfmake requires all four style slots. We ship two weights: the bold slots carry
  // the real Bold face (a `**strong**` run has to LOOK bold, and pdfmake does no
  // synthetic bolding), while the italic slots fall back to their same-weight upright
  // face — the serializer's `*em*` runs then read as unemphasized rather than as a
  // missing-font failure.
  const fonts: TFontDictionary = {
    [PDF_FONT]: {
      normal: JETENDARD_VFS_KEY,
      bold: JETENDARD_BOLD_VFS_KEY,
      italics: JETENDARD_VFS_KEY,
      bolditalics: JETENDARD_BOLD_VFS_KEY,
    },
  };
  pdfMake.addFonts(fonts);
  fontsRegistered = true;
}

/**
 * Build a PDF from the conversation and download it directly — no print dialog
 * (design decision: bulk export must save unattended). `now` is passed in so the
 * filename is caller-controlled and testable.
 */
export async function downloadPdf(conversation: Conversation, now: Date): Promise<void> {
  registerFonts();
  const docDefinition = toPdfDocDefinition(conversation);
  await pdfMake.createPdf(docDefinition).download(pdfFilename(conversation, now));
}
