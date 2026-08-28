import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { htmlToMarkdown } from '../../src/core/html-to-markdown';
import type { Conversation } from '../../src/core/conversation';
import { PDF_FONT, PDF_FONT_FEATURES, pdfFilename, toPdfDocDefinition } from '../../src/export/pdf';

// fontkit ships no type declarations, so it is required untyped and narrowed here.
// It is what pdfkit (and therefore pdfmake) uses to lay text out, so laying a string
// out with the same font file and the same feature object the document definition
// carries is the closest a unit test gets to the glyphs the reader ends up copying
// out of the PDF — asserting on the doc definition alone would prove nothing.
interface FontkitFont {
  layout(text: string, features?: unknown): { glyphs: Array<{ name: string }> };
}
const fontkit = createRequire(import.meta.url)('fontkit') as {
  openSync(path: string): FontkitFont;
};
const jetendard = fontkit.openSync(
  fileURLToPath(new URL('../../src/export/fonts/Jetendard-Regular.ttf', import.meta.url)),
);
const glyphNames = (text: string, features?: unknown): string[] =>
  jetendard.layout(text, features).glyphs.map((g) => g.name);

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

// The content array is typed as Content (a broad union); tests know each node we
// emit is a text node, so narrow to read `.text`/`.style`.
function nodes(c: Conversation): Array<{ text?: unknown; style?: unknown; margin?: unknown }> {
  const content = toPdfDocDefinition(c).content;
  return content as Array<{ text?: unknown; style?: unknown; margin?: unknown }>;
}

// The inline runs of the first prose node of a single-message conversation.
function proseRuns(body: string): Array<{ text: string; style?: string }> {
  const all = nodes(conversation({ messages: [{ role: 'assistant', content: body }] }));
  const prose = all.find((n) => n.style !== 'title' && n.style !== 'role' && n.style !== 'code');
  return prose?.text as Array<{ text: string; style?: string }>;
}

describe('toPdfDocDefinition', () => {
  it('uses the embedded Jetendard font as the default style', () => {
    const def = toPdfDocDefinition(conversation());
    expect(def.defaultStyle).toMatchObject({ font: PDF_FONT });
  });

  it('places the title first as a title-styled node', () => {
    const [first] = nodes(conversation({ title: 'Weekend plan' }));
    expect(first).toMatchObject({ text: 'Weekend plan', style: 'title' });
  });

  it('flattens newlines in the title into a single line', () => {
    const [first] = nodes(conversation({ title: 'line one\nline two' }));
    expect(first).toMatchObject({ text: 'line one line two' });
  });

  it('emits role labels in message order', () => {
    const roleTexts = nodes(
      conversation({
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'system', content: 'third' },
        ],
      }),
    )
      .filter((n) => n.style === 'role')
      .map((n) => n.text);
    expect(roleTexts).toEqual(['User', 'Assistant', 'System']);
  });

  it('renders a fenced code block as a distinct code-styled node without the fences', () => {
    const content = 'before\n\n```py\nx = 1\n```\n\nafter';
    const all = nodes(conversation({ messages: [{ role: 'assistant', content }] }));
    const code = all.find((n) => n.style === 'code');
    expect(code).toBeDefined();
    expect(code?.text).toBe('x = 1');
    // The prose on either side survives as its own (non-code) nodes.
    const proseTexts = all.filter((n) => !n.style && typeof n.text === 'string').map((n) => n.text);
    expect(proseTexts).toContain('before');
    expect(proseTexts).toContain('after');
  });

  it('matches a variable-length fence (adapter emits >3 backticks when the body contains a ``` run)', () => {
    // The ChatGPT adapter's serializeCodeBlock uses a fence one backtick longer
    // than the longest backtick run inside the body. A body containing ``` is
    // therefore wrapped in a 4-backtick fence; the exporter must still recognize it.
    const content = '````\n```\n````';
    const all = nodes(conversation({ messages: [{ role: 'assistant', content }] }));
    const code = all.find((n) => n.style === 'code');
    expect(code).toBeDefined();
    expect(code?.text).toBe('```');
  });

  it('drops an empty fenced code block instead of emitting an empty boxed node', () => {
    const content = 'text\n\n```\n\n```';
    const all = nodes(conversation({ messages: [{ role: 'assistant', content }] }));
    expect(all.some((n) => n.style === 'code')).toBe(false);
    expect(all.some((n) => n.text === 'text')).toBe(true);
  });

  it('styles an inline-code run and drops its backticks', () => {
    const runs = proseRuns('call `reduce()` on it');
    expect(runs).toEqual([
      { text: 'call ' },
      { text: 'reduce()', style: 'inlineCode' },
      { text: ' on it' },
    ]);
  });

  it('gives the inline-code style the same tint as the fenced code block', () => {
    const styles = toPdfDocDefinition(conversation()).styles as Record<
      string,
      { background?: string }
    >;
    expect(styles.inlineCode?.background).toBe('#f4f4f4');
    expect(styles.code?.background).toBe('#f4f4f4');
  });

  // The serializer widens the fence and pads the body whenever the code text holds
  // a backtick (html-to-markdown `inlineCode`, per CommonMark), so the exporter is
  // fed those forms in practice. Driving this end to end — HTML through the real
  // serializer into the exporter — is what proves the two stay in step.
  it.each([
    ['<p>call <code>reduce()</code> now</p>', 'call ', 'reduce()', ' now'],
    ['<p>see <code>a`b</code> here</p>', 'see ', 'a`b', ' here'],
    ['<p>see <code>a``b</code> here</p>', 'see ', 'a``b', ' here'],
    ['<p>see <code>`</code> here</p>', 'see ', '`', ' here'],
  ])('carries %s through the serializer into a styled run', (html, before, code, after) => {
    const window = new Window();
    const container = window.document.createElement('div');
    container.innerHTML = html;
    const runs = proseRuns(htmlToMarkdown(container as unknown as Element));
    expect(runs).toEqual([
      { text: before },
      { text: code, style: 'inlineCode' },
      { text: after },
    ]);
  });

  it('does not pair backticks that the serializer escaped as literal text', () => {
    const window = new Window();
    const container = window.document.createElement('div');
    container.innerHTML = '<p>a ` b ` c</p>'; // literal backticks in prose, not code
    const markdown = htmlToMarkdown(container as unknown as Element);
    expect(markdown).toBe('a \\` b \\` c');
    const all = nodes(conversation({ messages: [{ role: 'assistant', content: markdown }] }));
    // One plain string, no runs — and the escapes that kept it literal in the
    // Markdown export do not reach the page (see the unescaping cases below).
    expect(all.some((n) => n.text === 'a ` b ` c')).toBe(true);
  });

  // The PDF renders prose, not Markdown source: the backslashes `escapeMarkdownText`
  // added so the *Markdown* export stays valid are delimiters of that format, and
  // showing them on the page is showing the reader punctuation the source page never
  // had. Driven through the real serializer so the cases are the ones it actually
  // emits, not hand-invented escapes.
  it.each([
    ['<p>see [1] and a ` b</p>', 'see [1] and a ` b'],
    ['<p>a | b</p>', 'a | b'],
    ['<p>*emph* and _under_</p>', '*emph* and _under_'],
    ['<p>C:\\path</p>', 'C:\\path'],
    ['<p># not a heading</p>', '# not a heading'],
  ])('strips the Markdown escapes from %s before rendering it', (html, expected) => {
    const window = new Window();
    const container = window.document.createElement('div');
    container.innerHTML = html;
    const markdown = htmlToMarkdown(container as unknown as Element);
    expect(markdown).toContain('\\'); // the escape is really there in the source
    const all = nodes(conversation({ messages: [{ role: 'assistant', content: markdown }] }));
    expect(all.some((n) => n.text === expected)).toBe(true);
  });

  it('leaves a backslash inside an inline-code run alone (code bodies are never escaped)', () => {
    const window = new Window();
    const container = window.document.createElement('div');
    container.innerHTML = '<p>run <code>C:\\path</code> now</p>';
    const runs = proseRuns(htmlToMarkdown(container as unknown as Element));
    expect(runs).toEqual([
      { text: 'run ' },
      { text: 'C:\\path', style: 'inlineCode' },
      { text: ' now' },
    ]);
  });

  it('leaves a backslash inside a fenced code block alone', () => {
    const body = '```\nconst re = /\\d+/;\n```';
    const all = nodes(conversation({ messages: [{ role: 'assistant', content: body }] }));
    expect(all.some((n) => n.style === 'code' && n.text === 'const re = /\\d+/;')).toBe(true);
  });

  it('leaves an unpaired backtick as literal text', () => {
    const all = nodes(conversation({ messages: [{ role: 'assistant', content: 'a ` b' }] }));
    expect(all.some((n) => n.text === 'a ` b')).toBe(true);
  });

  it('leaves an empty backtick pair as literal text', () => {
    const all = nodes(conversation({ messages: [{ role: 'assistant', content: 'a `` b' }] }));
    expect(all.some((n) => n.text === 'a `` b')).toBe(true);
  });

  it('does not treat a backtick pair spanning a newline as inline code', () => {
    // Stays a plain string node rather than being split into runs.
    expect(proseRuns('a `b\nc` d') as unknown).toBe('a `b\nc` d');
  });

  it('disables the font ligatures so `=>` stays two glyphs in the PDF', () => {
    // Without the features the font substitutes a ligature glyph — matched by name
    // rather than by the exact glyph run, which varies with the shaper version.
    expect(glyphNames('=>').some((n) => n.endsWith('.liga'))).toBe(true);
    expect(glyphNames('=>', PDF_FONT_FEATURES)).toEqual(['equal', 'greater']);
  });

  it('carries the ligature-disabling features on the default style', () => {
    expect(toPdfDocDefinition(conversation()).defaultStyle).toMatchObject({
      fontFeatures: PDF_FONT_FEATURES,
    });
  });

  it('leaves CJK glyph output unchanged when ligatures are disabled', () => {
    expect(glyphNames('안녕하세요', PDF_FONT_FEATURES)).toEqual(glyphNames('안녕하세요'));
  });

  it('carries CJK text through into the document definition', () => {
    const all = nodes(conversation({ messages: [{ role: 'user', content: '안녕하세요 세계' }] }));
    expect(all.some((n) => n.text === '안녕하세요 세계')).toBe(true);
  });

  it('renders a title-only document when there are no messages', () => {
    const content = toPdfDocDefinition(conversation({ title: 'Empty', messages: [] })).content;
    expect(content).toEqual([{ text: 'Empty', style: 'title' }]);
  });

  it('is deterministic — same conversation yields a deep-equal definition', () => {
    const c = conversation();
    expect(toPdfDocDefinition(c)).toEqual(toPdfDocDefinition(c));
  });
});

describe('character fallbacks in the document definition', () => {
  it('rewrites a glyph-less character in the title', () => {
    const [first] = nodes(conversation({ title: '설정 -1.0℃' }));
    expect(first).toMatchObject({ text: '설정 -1.0\u00b0C', style: 'title' });
  });

  it('rewrites it inside prose, including a bold run', () => {
    const runs = proseRuns('보통 약 **-1.0℃**의 냉장 영역');
    expect(runs.map((r) => r.text).join('')).toBe('보통 약 -1.0\u00b0C의 냉장 영역');
  });

  it('rewrites it inside a fenced code block', () => {
    const all = nodes(conversation({ messages: [{ role: 'assistant', content: '```\nset -1.0℃\n```' }] }));
    expect(all.find((n) => n.style === 'code')).toMatchObject({ text: 'set -1.0\u00b0C' });
  });

  it('rewrites it inside a table cell', () => {
    const body = ['| 모드 | 온도 |', '| --- | --- |', '| 강 | -2.0℃ |'].join('\n');
    const all = nodes(conversation({ messages: [{ role: 'assistant', content: body }] }));
    expect(JSON.stringify(all)).toContain('-2.0\u00b0C');
    expect(JSON.stringify(all)).not.toContain('℃');
  });

  it('does not let a substitution introduce Markdown emphasis', () => {
    // ※ has no decomposition and stands in as `*`. Substituting on the source text
    // would make `※foo※` read as emphasis; substituting on the built nodes cannot.
    // A run with no emphasis stays a single plain string — an emphasised `참고`
    // would have split it into styled runs instead.
    const all = nodes(conversation({ messages: [{ role: 'assistant', content: '※참고※ 사항' }] }));
    const prose = all.find((n) => n.style !== 'title' && n.style !== 'role');
    expect(prose).toMatchObject({ text: '*참고* 사항' });
  });
});

describe('pdfFilename', () => {
  const date = new Date(2026, 0, 5); // 2026-01-05 (local); month is 0-based

  it('builds {provider}-{safe-title}-{yyyymmdd}.pdf', () => {
    expect(pdfFilename(conversation({ title: 'My chat' }), date)).toBe('chatgpt-My-chat-20260105.pdf');
  });

  it('shares sanitization with the other exporters (reserved chars → dashes)', () => {
    expect(pdfFilename(conversation({ title: 'a/b:c*?"<>|d' }), date)).toBe('chatgpt-a-b-c-d-20260105.pdf');
  });

  it('keeps the filename within the UTF-8 byte budget for a long CJK title', () => {
    const name = pdfFilename(conversation({ title: '가'.repeat(100) }), date);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
  });
});
