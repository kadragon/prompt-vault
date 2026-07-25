import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { geminiAdapter } from '../../../src/adapters/gemini';
import { ExtractionError } from '../../../src/core/errors';

// Passing a non-global document is what makes the adapter take the one-shot snapshot path
// instead of the live scroll walk (which `collect-paged.test.ts` covers).
function docFrom(html: string): Document {
  const window = new Window();
  window.document.write(html);
  return window.document as unknown as Document;
}

function loadFixture(name: string): Document {
  const path = fileURLToPath(new URL(`../../fixtures/gemini/${name}`, import.meta.url));
  return docFrom(readFileSync(path, 'utf-8'));
}

/** A minimal exchange, for the cases the fixture deliberately does not contain. */
function exchange(body: string, id = 'ex0'): string {
  return `<div class="conversation-container" id="${id}">${body}</div>`;
}

const userQuery = (text: string): string =>
  '<user-query><div class="query-text">' +
  '<span class="cdk-visually-hidden">말씀하신 내용</span>' +
  `<p class="query-text-line">${text}</p>` +
  '</div></user-query>';

const modelResponse = (inner: string, busy = 'false'): string =>
  `<model-response><div class="markdown" aria-busy="${busy}">${inner}</div></model-response>`;

describe('geminiAdapter.extract', () => {
  it('stamps the provider and the title, stripping Gemini’s document-title suffix', async () => {
    const convo = await geminiAdapter.extract(loadFixture('short.html'));
    expect(convo.provider).toBe('gemini');
    // document.title is "Fixture conversation - Google Gemini" (live format verified 2026-07-25).
    expect(convo.title).toBe('Fixture conversation');
  });

  it('falls back to a generic title when the page has no conversation title yet', async () => {
    const convo = await geminiAdapter.extract(
      docFrom(
        '<html><head><title>Google Gemini</title></head><body>' +
          exchange(modelResponse('<p>hi</p>')) +
          '</body></html>',
      ),
    );
    expect(convo.title).toBe('Gemini conversation');
  });

  it('strips the invisible left-to-right mark Gemini prefixes while loading', async () => {
    // Live: the loading title is "‎Google Gemini". Left in place, the bare-title
    // comparison silently fails and the LRM leaks into every exported filename.
    const convo = await geminiAdapter.extract(
      docFrom(
        '<html><head><title>‎Google Gemini</title></head><body>' +
          exchange(modelResponse('<p>hi</p>')) +
          '</body></html>',
      ),
    );
    expect(convo.title).toBe('Gemini conversation');
  });

  it('reads both roles in conversation order, one pair per exchange container', async () => {
    // Gemini has no per-message wrapper: a container holds a prompt AND its reply, so the
    // interleaving comes from reading each container's two halves in order.
    const convo = await geminiAdapter.extract(loadFixture('short.html'));
    expect(convo.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('excludes the screen-reader label from the user’s own words', async () => {
    // Live (2026-07-25): a naive textContent read of `.query-text` returned
    // "말씀하신 내용 <the prompt>" — Angular Material's visually-hidden label.
    const convo = await geminiAdapter.extract(loadFixture('short.html'));
    expect(convo.messages[0].content).toBe('First fixture question.');
    expect(convo.messages.some((m) => m.content.includes('말씀하신'))).toBe(false);
  });

  it('keeps the blank lines that separate a prompt’s paragraphs', async () => {
    // Live (2026-07-25) on two real prompts: a blank line the user typed renders as an EMPTY
    // `p.query-text-line` holding a `<br>` (136 lines / 42 empty, and 16 / 4). Dropping those
    // empties — as the first revision did with `.filter(Boolean)` — flattens every paragraph
    // break in the prompt, which on the 136-line prompt meant losing all 42 of them.
    const convo = await geminiAdapter.extract(loadFixture('short.html'));
    expect(convo.messages[2].content).toBe('A follow-up question.\n\nWith a second line.');
  });

  it('joins adjacent lines with a single newline', async () => {
    const html = exchange(
      '<user-query><div class="query-text">' +
        '<span class="cdk-visually-hidden">말씀하신 내용</span>' +
        '<p class="query-text-line">first line</p>' +
        '<p class="query-text-line">second line</p>' +
        '</div></user-query>' +
        modelResponse('<p>reply</p>'),
    );
    const convo = await geminiAdapter.extract(docFrom(html));
    expect(convo.messages[0].content).toBe('first line\nsecond line');
  });

  it('trims leading and trailing blank lines but not interior ones', async () => {
    const html = exchange(
      '<user-query><div class="query-text">' +
        '<span class="cdk-visually-hidden">말씀하신 내용</span>' +
        '<p class="query-text-line"><br></p>' +
        '<p class="query-text-line">para one</p>' +
        '<p class="query-text-line"><br></p>' +
        '<p class="query-text-line"><br></p>' +
        '<p class="query-text-line">para two</p>' +
        '<p class="query-text-line"><br></p>' +
        '</div></user-query>' +
        modelResponse('<p>reply</p>'),
    );
    const convo = await geminiAdapter.extract(docFrom(html));
    expect(convo.messages[0].content).toBe('para one\n\n\npara two');
  });

  it('falls through to the fallback read when every line element is blank', async () => {
    const html = exchange(
      '<user-query><div class="query-text">' +
        '<span class="cdk-visually-hidden">말씀하신 내용</span>' +
        '<p class="query-text-line"><br></p>' +
        '<img src="x.png">' +
        '</div></user-query>' +
        modelResponse('<p>reply</p>'),
    );
    const convo = await geminiAdapter.extract(docFrom(html));
    expect(convo.messages[0].content).toBe('[Image]');
  });

  it('falls back to the block’s own text, minus the label, when no line element exists', async () => {
    // The multi-line shape was not measurable live, so the reader must not depend on the line
    // elements being there at all — a markup change has to degrade, not blank the turn.
    const html = exchange(
      '<user-query><div class="query-text">' +
        '<span class="cdk-visually-hidden">말씀하신 내용</span>a bare prompt' +
        '</div></user-query>' +
        modelResponse('<p>reply</p>'),
    );
    const convo = await geminiAdapter.extract(docFrom(html));
    expect(convo.messages[0].content).toBe('a bare prompt');
  });

  it('describes an image-only prompt rather than failing the whole export', async () => {
    const html = exchange(
      '<user-query><div class="query-text">' +
        '<span class="cdk-visually-hidden">말씀하신 내용</span><img src="x.png">' +
        '</div></user-query>' +
        modelResponse('<p>reply</p>'),
    );
    const convo = await geminiAdapter.extract(docFrom(html));
    expect(convo.messages[0]).toEqual({ role: 'user', content: '[Image]' });
  });

  it('serializes assistant prose to Markdown, including lists and a language-tagged fence', async () => {
    const convo = await geminiAdapter.extract(loadFixture('short.html'));
    expect(convo.messages[1].content).toBe(
      'An answer with **bold** and `inline code`.\n\n' +
        '1. First step\n2. Second step\n\n' +
        '```python\nprint("hello")\n```',
    );
  });

  it('does not emit Gemini’s code-block header label as a paragraph of prose', async () => {
    // The label is a SIBLING of the <pre>, so an un-normalized serialization renders it as a
    // one-word paragraph above the fence.
    const convo = await geminiAdapter.extract(loadFixture('short.html'));
    expect(convo.messages[1].content).not.toMatch(/^Python$/m);
  });

  it('leaves a fence unlabelled when the block carries no language header', async () => {
    // Live (2026-07-25): one block in the same response rendered with no decoration at all,
    // so an absent label is a normal case and must not be invented.
    const html = exchange(
      userQuery('q') +
        modelResponse(
          '<code-block><div class="code-block"><pre><code class="code-container formatted">plain text</code></pre></div></code-block>',
        ),
    );
    const convo = await geminiAdapter.extract(docFrom(html));
    expect(convo.messages[1].content).toBe('```\nplain text\n```');
  });

  it('does not turn a non-language header into a bogus fence language', async () => {
    // core's `languageFromClass` re-validates the token the adapter copies across, so a label
    // that is not language-shaped yields no language rather than a fabricated one.
    const html = exchange(
      userQuery('q') +
        modelResponse(
          '<code-block><div class="code-block">' +
            '<div class="code-block-decoration"><span>복사</span></div>' +
            '<pre><code class="code-container formatted">body</code></pre>' +
            '</div></code-block>',
        ),
    );
    const convo = await geminiAdapter.extract(docFrom(html));
    expect(convo.messages[1].content).toBe('```\nbody\n```');
  });

  it('does not mutate the live tree while normalizing a code block', async () => {
    // The normalization deletes the label and the copy buttons; doing that in place would
    // rewrite the page the user is reading.
    const doc = loadFixture('short.html');
    await geminiAdapter.extract(doc);
    expect(doc.querySelector('div.code-block-decoration')).not.toBeNull();
    expect(doc.querySelector('code-block div.buttons')).not.toBeNull();
  });

  it('omits the message id, which Gemini does not expose per message', async () => {
    // The only id Gemini gives is the exchange container's, shared by both turns in it.
    const convo = await geminiAdapter.extract(loadFixture('short.html'));
    expect(convo.messages.every((m) => m.id === undefined)).toBe(true);
  });

  it('fails loud rather than returning an empty conversation', async () => {
    await expect(
      geminiAdapter.extract(docFrom('<body><main>no exchanges here</main></body>')),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('fails loud when a response is still generating', async () => {
    const html = exchange(userQuery('q') + modelResponse('<p>half an ans</p>', 'true'));
    await expect(geminiAdapter.extract(docFrom(html))).rejects.toThrow(/still generating/);
  });

  it('fails loud when a response container is present but empty', async () => {
    // An empty prose container is consistent with a half-rendered page, so retrying can help
    // and the message says so.
    const html = exchange(userQuery('a question') + modelResponse(''));
    await expect(geminiAdapter.extract(docFrom(html))).rejects.toThrow(/still be loading/);
  });

  it('tells the user to report a response that renders no text area at all', async () => {
    // Distinct from the empty case: a `model-response` with no `.markdown` anywhere is a shape
    // this adapter does not know (a generated image or canvas panel are the unmeasured
    // candidates), so "wait for it to finish and try again" would be advice that never clears.
    const html = exchange(
      userQuery('a question') + '<model-response><div class="something-else">?</div></model-response>',
    );
    await expect(geminiAdapter.extract(docFrom(html))).rejects.toThrow(/could not read/);
    await expect(geminiAdapter.extract(docFrom(html))).rejects.not.toThrow(/still be loading/);
  });

  it('fails loud when a prompt is present but unreadable', async () => {
    const html = exchange(
      '<user-query><div class="query-text"></div></user-query>' + modelResponse('<p>reply</p>'),
    );
    await expect(geminiAdapter.extract(docFrom(html))).rejects.toBeInstanceOf(ExtractionError);
  });

  it('fails loud on an exchange container holding neither half', async () => {
    const html =
      exchange(userQuery('q') + modelResponse('<p>a</p>'), 'ex0') +
      exchange('<div>something this adapter does not understand</div>', 'ex1');
    await expect(geminiAdapter.extract(docFrom(html))).rejects.toBeInstanceOf(ExtractionError);
  });

  it('exports a prompt whose answer was never generated, without failing', async () => {
    // A stopped or unanswered exchange drops nothing by exporting the prompt alone.
    const html =
      exchange(userQuery('first') + modelResponse('<p>answered</p>'), 'ex0') +
      exchange(userQuery('stopped before answering'), 'ex1');
    const convo = await geminiAdapter.extract(docFrom(html));
    expect(convo.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(convo.messages[2].content).toBe('stopped before answering');
  });
});
