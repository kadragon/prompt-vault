// Runtime PDF generation + download. This module is the DOM/browser-facing half of
// the PDF exporter: it pulls in pdfmake (heavy) and is reached ONLY through a dynamic
// `import()` from src/content/index.ts on the PDF button action, so @crxjs code-splits
// pdfmake into a separate chunk that never loads on an ordinary page visit. The font
// faces are no longer part of that chunk — they are read from the extension package on
// first export (see ../export/fonts/jetendard).
//
// No network primitive here (Golden Principle #1): the font bytes are read out of the
// extension package by ../export/fonts/jetendard (a `chrome-extension://` URL, never a
// remote origin) and pdfmake's `.download()` builds the file locally via a blob URL
// internally.

import pdfMake from 'pdfmake/build/pdfmake';
import type { TFontDictionary } from 'pdfmake/interfaces';
import {
  JETENDARD_BOLD_VFS_KEY,
  JETENDARD_VFS_KEY,
  loadJetendardVfs,
} from '../export/fonts/jetendard';
import { collectUnsupportedChars, PDF_FONT, pdfFilename, toPdfDocDefinition } from '../export/pdf';
import type { Conversation } from '../core/conversation';

// Register the font once per page. pdfmake accumulates vfs/font entries globally, so
// guard against re-registering on repeated PDF exports. The guard is the in-flight
// promise, not a boolean: reading the faces is now asynchronous, so two exports started
// back to back would otherwise both fetch. A failed load is not cached — clearing the
// slot lets the next export retry rather than repeating the first failure forever.
let registration: Promise<void> | null = null;

function ensureFontsRegistered(): Promise<void> {
  registration ??= registerFonts().catch((error: unknown) => {
    registration = null;
    throw error;
  });
  return registration;
}

async function registerFonts(): Promise<void> {
  pdfMake.addVirtualFileSystem(await loadJetendardVfs());
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
}

/**
 * Build a PDF from the conversation and download it directly — no print dialog
 * (design decision: bulk export must save unattended). `now` is passed in so the
 * filename is caller-controlled and testable.
 *
 * Returns the characters the document contains that no embedded face can draw — they
 * export as tofu boxes, so the caller warns about them (AGENTS.md #4). Empty is the
 * ordinary case. The download itself still succeeds: a partly-boxed PDF is worth more
 * than no PDF, as long as the user is told.
 */
export async function downloadPdf(conversation: Conversation, now: Date): Promise<string[]> {
  await ensureFontsRegistered();
  const docDefinition = toPdfDocDefinition(conversation);
  await pdfMake.createPdf(docDefinition).download(pdfFilename(conversation, now));
  return collectUnsupportedChars(docDefinition);
}
