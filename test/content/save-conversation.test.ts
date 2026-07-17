import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import type { Conversation } from '../../src/core/conversation';
import { toMarkdown } from '../../src/export/markdown';
import { toJson } from '../../src/export/json';
import { toHtml } from '../../src/export/html';
import { saveConversation } from '../../src/content/save-conversation';

// The PDF path pulls in pdfmake + the embedded font (heavy, browser-oriented). Mock
// it so the test asserts delegation without generating a real PDF.
const downloadPdf = vi.fn<(c: Conversation, now: Date) => Promise<void>>().mockResolvedValue(undefined);
vi.mock('../../src/content/pdf-download', () => ({ downloadPdf: (c: Conversation, now: Date) => downloadPdf(c, now) }));

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    title: 'My chat',
    provider: 'chatgpt',
    url: 'https://chatgpt.com/c/abc',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ],
    ...overrides,
  };
}

function bodyDoc(): Document {
  const window = new Window();
  window.document.write('<body></body>');
  return window.document as unknown as Document;
}

const NOW = new Date(2026, 6, 17); // 2026-07-17, local

// URL.createObjectURL / revokeObjectURL are browser-only (absent in the node test
// env); install stubs that capture the blob so the test can inspect what would have
// been downloaded, then remove them afterward.
let createdBlobs: Blob[];
type UrlStubs = { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void };

beforeEach(() => {
  // Fake timers so the deferred URL.revokeObjectURL (a `setTimeout(…, 0)` inside the
  // download) fires deterministically in afterEach while the stub still exists,
  // instead of leaking into a later tick after cleanup.
  vi.useFakeTimers();
  createdBlobs = [];
  const url = URL as unknown as UrlStubs;
  url.createObjectURL = (blob: Blob) => {
    createdBlobs.push(blob);
    return 'blob:mock';
  };
  url.revokeObjectURL = () => {};
  downloadPdf.mockClear();
});

afterEach(() => {
  vi.runOnlyPendingTimers(); // fire the deferred revokeObjectURL while the stub is present
  vi.useRealTimers();
  const url = URL as unknown as Partial<UrlStubs>;
  delete url.createObjectURL;
  delete url.revokeObjectURL;
});

describe('saveConversation', () => {
  it('md: downloads the markdown with the derived filename and content', async () => {
    const doc = bodyDoc();
    let downloadName = '';
    const realAppend = doc.body.appendChild.bind(doc.body);
    vi.spyOn(doc.body, 'appendChild').mockImplementation((node: Node) => {
      downloadName = (node as HTMLAnchorElement).download;
      return realAppend(node);
    });

    const conv = conversation();
    await saveConversation(conv, 'md', NOW, doc);

    expect(downloadName).toBe('chatgpt-My-chat-20260717.md');
    expect(createdBlobs).toHaveLength(1);
    expect(createdBlobs[0].type).toBe('text/markdown');
    expect(await createdBlobs[0].text()).toBe(toMarkdown(conv));
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  it('md: removes the transient anchor after clicking (no leftover in the DOM)', async () => {
    const doc = bodyDoc();
    await saveConversation(conversation(), 'md', NOW, doc);
    expect(doc.querySelectorAll('a')).toHaveLength(0);
  });

  it('json: downloads the JSON with the derived filename, mime, and content', async () => {
    const doc = bodyDoc();
    let downloadName = '';
    const realAppend = doc.body.appendChild.bind(doc.body);
    vi.spyOn(doc.body, 'appendChild').mockImplementation((node: Node) => {
      downloadName = (node as HTMLAnchorElement).download;
      return realAppend(node);
    });

    const conv = conversation();
    await saveConversation(conv, 'json', NOW, doc);

    expect(downloadName).toBe('chatgpt-My-chat-20260717.json');
    expect(createdBlobs).toHaveLength(1);
    expect(createdBlobs[0].type).toBe('application/json');
    expect(await createdBlobs[0].text()).toBe(toJson(conv));
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  it('html: downloads the HTML with the derived filename, mime, and content', async () => {
    const doc = bodyDoc();
    let downloadName = '';
    const realAppend = doc.body.appendChild.bind(doc.body);
    vi.spyOn(doc.body, 'appendChild').mockImplementation((node: Node) => {
      downloadName = (node as HTMLAnchorElement).download;
      return realAppend(node);
    });

    const conv = conversation();
    await saveConversation(conv, 'html', NOW, doc);

    expect(downloadName).toBe('chatgpt-My-chat-20260717.html');
    expect(createdBlobs).toHaveLength(1);
    expect(createdBlobs[0].type).toBe('text/html');
    expect(await createdBlobs[0].text()).toBe(toHtml(conv));
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  it('pdf: delegates to downloadPdf with the conversation and date, writing no blob itself', async () => {
    const doc = bodyDoc();
    const conv = conversation();
    await saveConversation(conv, 'pdf', NOW, doc);

    expect(downloadPdf).toHaveBeenCalledTimes(1);
    expect(downloadPdf).toHaveBeenCalledWith(conv, NOW);
    expect(createdBlobs).toHaveLength(0);
  });
});
