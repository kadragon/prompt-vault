import { describe, it, expect, vi, beforeEach } from 'vitest';
import { conversation } from '../fixtures/conversation';
import {
  CJK_BOLD_VFS_KEY,
  CJK_VFS_KEY,
  JETENDARD_BOLD_VFS_KEY,
  JETENDARD_VFS_KEY,
} from '../../src/export/fonts/jetendard';
import { PDF_CJK_FONT, PDF_FONT } from '../../src/export/pdf';

// pdfmake and the font loader are both stubbed: this file is about the registration
// guard in pdf-download.ts, not about producing a real PDF. `vi.mock` is hoisted, so the
// spies live in a factory-visible object rather than in module-scope `let`s.
const stubs = vi.hoisted(() => ({
  loadJetendardVfs: vi.fn(),
  loadCjkVfs: vi.fn(),
  addVirtualFileSystem: vi.fn(),
  addFonts: vi.fn(),
  download: vi.fn(),
}));

vi.mock('pdfmake/build/pdfmake', () => ({
  default: {
    addVirtualFileSystem: stubs.addVirtualFileSystem,
    addFonts: stubs.addFonts,
    createPdf: () => ({ download: stubs.download }),
  },
}));

vi.mock('../../src/export/fonts/jetendard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/export/fonts/jetendard')>()),
  loadJetendardVfs: stubs.loadJetendardVfs,
  loadCjkVfs: stubs.loadCjkVfs,
}));

const NOW = new Date(2026, 6, 17);
const CONVERSATION = conversation({ messages: [{ role: 'user', content: 'Hello' }] });
const JAPANESE = conversation({ messages: [{ role: 'user', content: 'こんにちは、世界' }] });

// The registration guard is module state, so every test needs a fresh module instance.
async function freshDownloadPdf(): Promise<typeof import('../../src/content/pdf-download').downloadPdf> {
  vi.resetModules();
  return (await import('../../src/content/pdf-download')).downloadPdf;
}

beforeEach(() => {
  for (const stub of Object.values(stubs)) stub.mockReset();
  stubs.download.mockResolvedValue(undefined);
});

describe('downloadPdf font registration', () => {
  it('reads the faces once, however many exports run', async () => {
    stubs.loadJetendardVfs.mockResolvedValue({ 'Jetendard-Regular.ttf': 'AAA' });
    const downloadPdf = await freshDownloadPdf();

    await downloadPdf(CONVERSATION, NOW);
    await downloadPdf(CONVERSATION, NOW);

    expect(stubs.loadJetendardVfs).toHaveBeenCalledTimes(1);
    expect(stubs.addVirtualFileSystem).toHaveBeenCalledTimes(1);
    expect(stubs.addFonts).toHaveBeenCalledTimes(1);
    expect(stubs.download).toHaveBeenCalledTimes(2);
  });

  it('registers the family the document asks for, with the bold slots on the Bold face', async () => {
    stubs.loadJetendardVfs.mockResolvedValue({ [JETENDARD_VFS_KEY]: 'AAA', [JETENDARD_BOLD_VFS_KEY]: 'BBB' });
    const downloadPdf = await freshDownloadPdf();

    await downloadPdf(CONVERSATION, NOW);

    // pdfmake throws on any family it was not given, so an empty dictionary breaks every export.
    expect(stubs.addFonts).toHaveBeenCalledWith({
      [PDF_FONT]: {
        normal: JETENDARD_VFS_KEY,
        bold: JETENDARD_BOLD_VFS_KEY,
        italics: JETENDARD_VFS_KEY,
        bolditalics: JETENDARD_BOLD_VFS_KEY,
      },
    });
  });

  it('reads the faces once when two exports start before either finishes', async () => {
    // The guard is the in-flight promise rather than a boolean precisely for this: the
    // load is now asynchronous, so a bare `if (registered)` would let both calls through
    // and register pdfmake's global vfs twice.
    let release!: (vfs: Record<string, string>) => void;
    stubs.loadJetendardVfs.mockReturnValue(
      new Promise<Record<string, string>>((resolve) => (release = resolve)),
    );
    const downloadPdf = await freshDownloadPdf();

    const both = Promise.all([downloadPdf(CONVERSATION, NOW), downloadPdf(CONVERSATION, NOW)]);
    release({ 'Jetendard-Regular.ttf': 'AAA' });
    await both;

    expect(stubs.loadJetendardVfs).toHaveBeenCalledTimes(1);
    expect(stubs.addVirtualFileSystem).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure — the next export retries', async () => {
    // A cached rejection would break PDF export for the whole lifetime of the page over
    // one transient read, with no way back but a reload.
    stubs.loadJetendardVfs.mockRejectedValueOnce(new Error('read failed'));
    stubs.loadJetendardVfs.mockResolvedValueOnce({ 'Jetendard-Regular.ttf': 'AAA' });
    const downloadPdf = await freshDownloadPdf();

    await expect(downloadPdf(CONVERSATION, NOW)).rejects.toThrow('read failed');
    expect(stubs.download).not.toHaveBeenCalled();

    await downloadPdf(CONVERSATION, NOW);

    expect(stubs.loadJetendardVfs).toHaveBeenCalledTimes(2);
    expect(stubs.download).toHaveBeenCalledTimes(1);
  });

  it('reports the undrawable characters of the document it saved', async () => {
    stubs.loadJetendardVfs.mockResolvedValue({ 'Jetendard-Regular.ttf': 'AAA' });
    const downloadPdf = await freshDownloadPdf();

    const covered = await downloadPdf(CONVERSATION, NOW);
    expect(covered).toEqual([]);

    stubs.loadCjkVfs.mockResolvedValue({ [CJK_VFS_KEY]: 'CCC' });
    const mixed = await downloadPdf({ ...CONVERSATION, messages: [{ role: 'user', content: 'あ 中 😀' }] }, NOW);
    expect(mixed).toEqual(['😀']);
  });
});

describe('downloadPdf CJK font registration', () => {
  beforeEach(() => {
    stubs.loadJetendardVfs.mockResolvedValue({ [JETENDARD_VFS_KEY]: 'AAA' });
  });

  it('never reads the CJK faces for a document that does not need them', async () => {
    const downloadPdf = await freshDownloadPdf();

    await downloadPdf(conversation({ messages: [{ role: 'user', content: '안녕하세요 Hello' }] }), NOW);

    expect(stubs.loadCjkVfs).not.toHaveBeenCalled();
    expect(stubs.addFonts).toHaveBeenCalledTimes(1);
  });

  it('registers the CJK family, bold slots on its Bold face, before a Japanese export', async () => {
    stubs.loadCjkVfs.mockResolvedValue({ [CJK_VFS_KEY]: 'CCC', [CJK_BOLD_VFS_KEY]: 'DDD' });
    const downloadPdf = await freshDownloadPdf();

    await downloadPdf(JAPANESE, NOW);

    expect(stubs.addVirtualFileSystem).toHaveBeenCalledWith({ [CJK_VFS_KEY]: 'CCC', [CJK_BOLD_VFS_KEY]: 'DDD' });
    expect(stubs.addFonts).toHaveBeenCalledWith({
      [PDF_CJK_FONT]: {
        normal: CJK_VFS_KEY,
        bold: CJK_BOLD_VFS_KEY,
        italics: CJK_VFS_KEY,
        bolditalics: CJK_BOLD_VFS_KEY,
      },
    });
    // Registered before pdfmake lays the document out, or it throws on an unknown family.
    expect(stubs.addFonts.mock.invocationCallOrder.at(-1)).toBeLessThan(
      stubs.download.mock.invocationCallOrder[0],
    );
  });

  it('reads the CJK faces once across exports, and retries after a failed read', async () => {
    stubs.loadCjkVfs.mockRejectedValueOnce(new Error('cjk read failed'));
    stubs.loadCjkVfs.mockResolvedValue({ [CJK_VFS_KEY]: 'CCC' });
    const downloadPdf = await freshDownloadPdf();

    await expect(downloadPdf(JAPANESE, NOW)).rejects.toThrow('cjk read failed');
    expect(stubs.download).not.toHaveBeenCalled();

    await downloadPdf(JAPANESE, NOW);
    await downloadPdf(JAPANESE, NOW);

    expect(stubs.loadCjkVfs).toHaveBeenCalledTimes(2);
    expect(stubs.download).toHaveBeenCalledTimes(2);
  });
});
