import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { chatgptAdapter } from '../../../src/adapters/chatgpt';
import { ExtractionError } from '../../../src/core/errors';
import type { Conversation } from '../../../src/core/conversation';
import { IMAGE_TILE, assistantUnit, fileTile, page, turn, userMarkdownBubble, userUnit } from './markup';

// Load a captured fixture into a parsed document and run the adapter against it.
// Passing this document (not the global one) makes the adapter skip auto-scroll.
function extractFixture(name: string): Promise<Conversation> {
  const path = fileURLToPath(new URL(`../../fixtures/chatgpt/${name}`, import.meta.url));
  const html = readFileSync(path, 'utf-8');
  const window = new Window();
  window.document.write(html);
  return chatgptAdapter.extract(window.document as unknown as Document);
}

function extractHtml(html: string): Promise<Conversation> {
  const window = new Window();
  window.document.write(html);
  return chatgptAdapter.extract(window.document as unknown as Document);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('chatgptAdapter.extract — captured app-shell fixtures (2026-09-29)', () => {
  it('extracts both roles in order with provider message ids from a normal conversation', async () => {
    const convo = await extractFixture('short.html');

    expect(convo.provider).toBe('chatgpt');
    expect(convo.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(convo.messages.every((m) => UUID.test(m.id ?? ''))).toBe(true);
    expect(convo.title).toBe('Markdown demo response');
  });

  it('normalizes assistant formatting to Markdown', async () => {
    const assistant = (await extractFixture('short.html')).messages[1].content;

    expect(assistant).toContain('**bold text**');
    expect(assistant).toContain('*italic text*');
    expect(assistant).toMatch(/^- First item$/m);
    expect(assistant).toMatch(/^1\. Step one$/m);
    expect(assistant).toContain('```python\ndef greet(name):\n    return f"Hello, {name}!"\n```');
    expect(assistant).toContain('| Name | Value |');
    expect(assistant).toContain('](https://example.com)');
  });

  it('preserves user text verbatim (raw markdown-ish source, escaped)', async () => {
    const user = (await extractFixture('short.html')).messages[0].content;
    expect(user).toContain('Fixture test for a browser-extension parser.');
    expect(user).toContain('one \\*\\*bold\\*\\* phrase');
  });

  it('reads every code-block rendering with its language — CodeMirror and static <pre>', async () => {
    // The fixture holds one hydrated CodeMirror block (lines in `.cm-line`, no newline
    // characters) and two static `<pre>` blocks, as captured.
    const assistant = (await extractFixture('code-heavy.html')).messages[1].content;

    expect(assistant).toContain('```python\ndef squares(values):\n    result = [x * x for x in values]\n    return result\n```');
    expect(assistant).toContain('```javascript\nconst doubleValues = (values) => {');
    expect(assistant).toContain('```bash\necho "Starting"\necho "Finished"\n```');
    // Inline code is a <span> in this DOM, not a <code>.
    expect(assistant).toContain('`inline_code`');
    // The code-block header (language label, copy/run buttons) is chrome, not content.
    expect(assistant).not.toMatch(/^Python$/m);
  });

  it('restores the backticks the user bubble drops when it renders typed inline code', async () => {
    const user = (await extractFixture('code-heavy.html')).messages[0].content;
    expect(user).toContain('Mention the \\`inline_code\\` token');
  });

  it('describes an uploaded file beside the typed prompt', async () => {
    const convo = await extractFixture('attachment.html');
    expect(convo.messages[0].content).toBe(
      'Fixture test: reply with one short sentence acknowledging the attached file.\n\n[File: fixture-note.txt]',
    );
  });

  it('fails loud when no messages are present', async () => {
    await expect(extractFixture('empty.html')).rejects.toBeInstanceOf(ExtractionError);
  });
});

describe('chatgptAdapter.extract — shapes the fixtures do not hold', () => {
  it('fails loud when a turn is empty/malformed (dropped)', async () => {
    // One good user unit plus an assistant unit whose prose is empty — extraction must not
    // silently return just the user turn.
    await expect(
      extractHtml(page('T', turn('t1', userUnit('u1', 'hi'), assistantUnit('a1 a1', '')))),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('describes a file-only user turn instead of dropping it', async () => {
    const convo = await extractHtml(
      page('T', turn('t1', userUnit('u1', null, fileTile('pasted text (1).txt')), assistantUnit('a1 a1', '<p>ok</p>'))),
    );
    expect(convo.messages).toHaveLength(2);
    expect(convo.messages[0].content).toBe('[File: pasted text (1).txt]');
  });

  it('describes an image-only user turn — no bubble at all — instead of dropping it', async () => {
    const convo = await extractHtml(
      page('T', turn('t1', userUnit('u1', null, IMAGE_TILE), assistantUnit('a1 a1', '<p>a tree</p>'))),
    );
    expect(convo.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', '[Image]'],
      ['assistant', 'a tree'],
    ]);
  });

  it('keeps an assistant-only turn (a scheduled task) and an unanswered prompt', async () => {
    const convo = await extractHtml(
      page(
        'T',
        turn('t1', assistantUnit('a1 a1', '<p>scheduled report</p>')),
        turn('t2', userUnit('u2', 'still waiting')),
      ),
    );
    expect(convo.messages.map((m) => [m.role, m.content, m.id])).toEqual([
      ['assistant', 'scheduled report', 'a1'],
      ['user', 'still waiting', 'u2'],
    ]);
  });

  it('serializes a prompt that renders as Markdown — its pasted block stays a code block', async () => {
    // Measured live: a prompt holding a fenced block renders paragraphs, inline-code spans and
    // header-less code blocks (static `code`, real newlines). Read as plain text it would
    // lose the fence and run the paragraph into the code.
    const bubble = userMarkdownBubble(
      '<p><span data-markdown-copy="inline-code">nginx -t</span><span> fails with **this**:</span></p>' +
        '<div data-markdown-copy="code-block"><div data-markdown-copy="exclude"><div></div></div>' +
        '<div class="overflow-auto"><code class="whitespace-pre! block">line 1\nline 2</code></div></div>',
    );
    const convo = await extractHtml(page('T', turn('t1', userUnit('u1', bubble), assistantUnit('a1 a1', '<p>ok</p>'))));
    expect(convo.messages[0].content).toBe('`nginx -t` fails with \\*\\*this\\*\\*:\n\n```\nline 1\nline 2\n```');
  });

  it('ids a multi-step reply by its last id — the reply itself', async () => {
    const convo = await extractHtml(page('T', turn('t1', userUnit('u1', 'q'), assistantUnit('tool1 tool2 final', '<p>a</p>'))));
    expect(convo.messages[1].id).toBe('final');
  });

  it('reads the static `code.whitespace-pre!` rendering, labelled only by its header', async () => {
    const block =
      '<div data-markdown-copy="code-block"><div data-markdown-copy="exclude"><div class="truncate">Python</div>' +
      '<button aria-label="복사"></button></div>' +
      '<div class="overflow-auto"><code class="whitespace-pre! block">x = 1\ny = 2</code></div></div>';
    const convo = await extractHtml(page('T', turn('t1', userUnit('u1', 'q'), assistantUnit('a1 a1', block))));
    expect(convo.messages[1].content).toBe('```python\nx = 1\ny = 2\n```');
  });

  it('never takes a header button caption for the language', async () => {
    const block =
      '<div data-markdown-copy="code-block"><div data-markdown-copy="exclude"><div></div><button>Copy</button></div>' +
      '<pre><code>plain</code></pre></div>';
    const convo = await extractHtml(page('T', turn('t1', userUnit('u1', 'q'), assistantUnit('a1 a1', block))));
    expect(convo.messages[1].content).toBe('```\nplain\n```');
  });

  it('fails loud on a virtualized CodeMirror block it cannot scroll (no layout)', async () => {
    // `.cm-gap` stands in for lines outside CodeMirror's viewport. Without a layout engine the
    // lines cannot be indexed, so the export must refuse rather than drop them silently.
    const block =
      '<div data-markdown-copy="code-block"><div class="overflow-auto"><div class="cm-content" data-language="python">' +
      '<div class="cm-gap"></div><div class="cm-line">print(40)</div></div></div></div>';
    await expect(
      extractHtml(page('T', turn('t1', userUnit('u1', 'q'), assistantUnit('a1 a1', block)))),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('exports a writing block as its content, without the card chrome', async () => {
    const rich =
      '<div data-markdown-copy="rich-block" data-markdown-copy-text="# src"><header><button>Doc title</button></header>' +
      '<div data-markdown-copy-content="true"><div class="ProseMirror"><p>Body line</p><ul><li><p>point</p></li></ul></div></div></div>';
    const convo = await extractHtml(page('T', turn('t1', userUnit('u1', 'q'), assistantUnit('a1 a1', `<p>Intro</p>${rich}`))));
    expect(convo.messages[1].content).toBe('Intro\n\nBody line\n\n- point');
  });

  it('keeps a citation as its link text, dropping the favicon', async () => {
    const cite =
      '<p>Fact <span><a data-testid="chatgpt-citation" href="https://example.org/a">' +
      '<span><img src="https://example.invalid/f.png" alt=""></span><span>example.org</span></a></span></p>';
    const convo = await extractHtml(page('T', turn('t1', userUnit('u1', 'q'), assistantUnit('a1 a1', cite))));
    expect(convo.messages[1].content).toBe('Fact [example.org](https://example.org/a)');
  });
});
