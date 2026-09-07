import { describe, it, expect, vi, beforeEach } from 'vitest';
import { conversation } from '../fixtures/conversation';

// pdfmake and the font loader are both stubbed: this file is about the registration
// guard in pdf-download.ts, not about producing a real PDF. `vi.mock` is hoisted, so the
// spies live in a factory-visible object rather than in module-scope `let`s.
const stubs = vi.hoisted(() => ({
  loadJetendardVfs: vi.fn(),
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
}));

const NOW = new Date(2026, 6, 17);
const CONVERSATION = conversation({ messages: [{ role: 'user', content: 'Hello' }] });

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

    const kana = await downloadPdf({ ...CONVERSATION, messages: [{ role: 'user', content: 'あ 😀' }] }, NOW);
    expect(kana).toEqual(['あ', '😀']);
  });
});
