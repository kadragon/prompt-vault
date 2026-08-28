import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { htmlToMarkdown } from '../../src/core/html-to-markdown';
import { renderMarkdown } from '../../src/export/markdown-pdf';

// The renderer's input is never hand-written Markdown in production — it is whatever
// `htmlToMarkdown` produced from the page. Cases that matter are therefore driven
// through the real serializer (`md(html)`), so a change on either side that pulls the
// two out of step fails here rather than in a user's PDF. Hand-written Markdown is
// used only where the point is a malformed/edge input the serializer cannot emit.
function md(html: string): string {
  const window = new Window();
  const container = window.document.createElement('div');
  container.innerHTML = html;
  return htmlToMarkdown(container as unknown as Element);
}

type Node = Record<string, unknown>;

const render = (body: string): Node[] => renderMarkdown(body) as unknown as Node[];

// Every string reachable from a content node, so a test can assert that a Markdown
// marker does not survive anywhere in the tree — including inside list items, table
// cells and blockquote stacks.
function allText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(allText).join('');
  if (node && typeof node === 'object') {
    const n = node as Node;
    return ['text', 'stack', 'ul', 'ol', 'table', 'body']
      .filter((k) => k in n)
      .map((k) => allText(n[k]))
      .join('');
  }
  return '';
}

// The inline runs of the first paragraph-ish node (anything carrying `text`).
function runs(body: string): unknown {
  const node = render(body).find((n) => 'text' in n);
  return node?.text;
}

describe('inline formatting', () => {
  it('renders **strong** as a bold run and drops the markers', () => {
    const markdown = md('<p>a <strong>bold</strong> b</p>');
    expect(markdown).toBe('a **bold** b');
    expect(runs(markdown)).toEqual([{ text: 'a ' }, { text: 'bold', bold: true }, { text: ' b' }]);
  });

  it('renders *em* as an italic run and drops the markers', () => {
    const markdown = md('<p>a <em>soft</em> b</p>');
    expect(markdown).toBe('a *soft* b');
    expect(runs(markdown)).toEqual([
      { text: 'a ' },
      { text: 'soft', italics: true },
      { text: ' b' },
    ]);
  });

  it('nests emphasis inside strong', () => {
    const markdown = md('<p><strong>very <em>very</em> bold</strong></p>');
    expect(runs(markdown)).toEqual([
      { text: 'very ', bold: true },
      { text: 'very', bold: true, italics: true },
      { text: ' bold', bold: true },
    ]);
  });

  it('renders a link as a clickable, link-styled run without its brackets', () => {
    const markdown = md('<p>see <a href="https://example.com/a">the docs</a> now</p>');
    expect(markdown).toBe('see [the docs](https://example.com/a) now');
    expect(runs(markdown)).toEqual([
      { text: 'see ' },
      { text: 'the docs', link: 'https://example.com/a', style: 'link' },
      { text: ' now' },
    ]);
  });

  it('keeps a link clickable through surrounding strong', () => {
    const markdown = md('<p><strong>see <a href="https://example.com">here</a></strong></p>');
    expect(runs(markdown)).toEqual([
      { text: 'see ', bold: true },
      { text: 'here', bold: true, link: 'https://example.com', style: 'link' },
    ]);
  });

  // The shape a ChatGPT citation serializes to: a favicon <img> inside the <a>. No
  // image can be fetched into the PDF, so the markup goes and the label stays
  // clickable — the alternative is the raw `[![](…)…](…)` the reader saw before.
  it('drops the favicon image inside a citation link and links the label', () => {
    const markdown = md(
      '<p>근거. <a href="https://taxlaw.nts.go.kr/qt/USEQTA002P.do?id=1">' +
        '<img src="https://www.google.com/s2/favicons?domain=x&amp;sz=128">국세법령정보시스템+1</a></p>',
    );
    expect(markdown).toContain('[![](');
    expect(runs(markdown)).toEqual([
      { text: '근거. ' },
      {
        text: '국세법령정보시스템+1',
        link: 'https://taxlaw.nts.go.kr/qt/USEQTA002P.do?id=1',
        style: 'link',
      },
    ]);
  });

  it('falls back to the href when the link label renders to nothing', () => {
    expect(runs('[![](https://cdn.example/icon.png)](https://example.com/page)')).toEqual([
      { text: 'https://example.com/page', link: 'https://example.com/page', style: 'link' },
    ]);
  });

  it('keeps a standalone image as its alt text, without the markup', () => {
    const markdown = md('<p>before <img src="https://cdn.example/x.png" alt="a chart"> after</p>');
    expect(markdown).toBe('before ![a chart](https://cdn.example/x.png) after');
    expect(allText(render(markdown))).toBe('before a chart after');
  });

  it('keeps a URL containing parentheses whole', () => {
    const url = 'https://ex.com/wiki/Foo_(bar)';
    expect(runs(`see [Foo](${url}) now`)).toEqual([
      { text: 'see ' },
      { text: 'Foo', link: url, style: 'link' },
      { text: ' now' },
    ]);
  });

  it('leaves an unpaired or empty delimiter as literal text', () => {
    expect(runs('2 * 3 * 4')).toBe('2 * 3 * 4');
    expect(runs('a ** b')).toBe('a ** b');
    expect(runs('see [not a link] here')).toBe('see [not a link] here');
  });

  it('does not pair emphasis across a line break', () => {
    expect(runs('a *b\nc* d')).toBe('a *b\nc* d');
  });

  it('leaves the emphasis characters the serializer escaped as literal text', () => {
    const markdown = md('<p>2 * 3 and snake_case and *stars*</p>');
    expect(markdown).toContain('\\*');
    expect(allText(render(markdown))).toBe('2 * 3 and snake_case and *stars*');
  });

  it('still styles inline code and strips its backticks', () => {
    expect(runs(md('<p>call <code>reduce()</code> now</p>'))).toEqual([
      { text: 'call ' },
      { text: 'reduce()', style: 'inlineCode' },
      { text: ' now' },
    ]);
  });

  it('carries both styles when inline code sits inside a link', () => {
    expect(runs('[`npm run test`](https://example.com)')).toEqual([
      {
        text: 'npm run test',
        link: 'https://example.com',
        style: ['inlineCode', 'link'],
      },
    ]);
  });
});

describe('block formatting', () => {
  it('renders each ATX heading level as its own style', () => {
    const markdown = md('<h1>One</h1><h3>Three</h3><h6>Six</h6>');
    expect(render(markdown)).toEqual([
      { text: 'One', style: 'h1' },
      { text: 'Three', style: 'h3' },
      { text: 'Six', style: 'h6' },
    ]);
  });

  it('styles inline formatting inside a heading', () => {
    const [heading] = render(md('<h2>Plan <strong>B</strong></h2>'));
    expect(heading).toEqual({ text: [{ text: 'Plan ' }, { text: 'B', bold: true }], style: 'h2' });
  });

  it('renders a blockquote as a left-barred block, marker dropped', () => {
    const markdown = md('<blockquote><p>수입인지 → <strong>국가의 인지세</strong> 납부</p></blockquote>');
    expect(markdown).toBe('> 수입인지 → **국가의 인지세** 납부');
    const [quote] = render(markdown);
    expect(allText(quote)).toBe('수입인지 → 국가의 인지세 납부');
    // The bar is drawn by the table layout, not by a `>` left in the text.
    expect(quote.table).toBeDefined();
    expect(allText(quote)).not.toContain('>');
  });

  it('keeps multiple blocks inside one blockquote', () => {
    const markdown = md('<blockquote><p>first</p><p>second</p></blockquote>');
    const [quote] = render(markdown);
    expect(allText(quote)).toBe('firstsecond');
  });

  it('renders a bullet list as a pdfmake ul', () => {
    const markdown = md('<ul><li>alpha</li><li><strong>beta</strong></li></ul>');
    const [list] = render(markdown);
    expect(list.ul).toEqual([
      { text: 'alpha', margin: [0, 2, 0, 2] },
      { text: [{ text: 'beta', bold: true }], margin: [0, 2, 0, 2] },
    ]);
  });

  it('renders an ordered list, carrying a non-default start', () => {
    const [plain] = render(md('<ol><li>one</li><li>two</li></ol>'));
    expect(plain.ol).toHaveLength(2);
    expect(plain.start).toBeUndefined();
    const [offset] = render(md('<ol start="3"><li>three</li></ol>'));
    expect(offset.start).toBe(3);
  });

  it('nests a sublist inside its parent item', () => {
    const markdown = md('<ul><li>parent<ul><li>child</li></ul></li></ul>');
    expect(markdown).toBe('- parent\n  - child');
    const [list] = render(markdown);
    const [item] = list.ul as Node[];
    const [inner] = (item.stack as Node[]).slice(1);
    expect(allText(item)).toBe('parentchild');
    expect(inner.ul).toBeDefined();
  });

  it('renders a GFM table with a styled header row', () => {
    const markdown = md(
      '<table><tr><th>구분</th><th>납부</th></tr><tr><td>수입인지</td><td><strong>인지세</strong></td></tr></table>',
    );
    expect(markdown).toContain('| --- | --- |');
    const [table] = render(markdown);
    const body = (table.table as Node).body as Node[][];
    expect(body[0]).toEqual([
      { text: '구분', style: 'tableHeader' },
      { text: '납부', style: 'tableHeader' },
    ]);
    expect(body[1]).toEqual([{ text: '수입인지' }, { text: [{ text: '인지세', bold: true }] }]);
    expect(allText(table)).not.toContain('|');
  });

  it('keeps an escaped pipe inside a table cell as content', () => {
    const markdown = md('<table><tr><th>a</th></tr><tr><td>x | y</td></tr></table>');
    expect(markdown).toContain('\\|');
    const [table] = render(markdown);
    const body = (table.table as Node).body as Node[][];
    expect(body[1]).toEqual([{ text: 'x | y' }]);
  });

  it('renders a horizontal rule as a drawn line, not three dashes', () => {
    const [rule] = render(md('<hr>'));
    expect(rule.canvas).toBeDefined();
    expect(allText(rule)).toBe('');
  });

  it('still renders a fenced code block without its fences', () => {
    const nodes = render('before\n\n```py\nx = 1\n```\n\nafter');
    expect(nodes.map((n) => n.text)).toEqual(['before', 'x = 1', 'after']);
    expect(nodes[1].style).toBe('code');
  });

  it('leaves an unterminated fence as prose rather than swallowing the rest', () => {
    const nodes = render('```py\nx = 1');
    expect(nodes.every((n) => n.style !== 'code')).toBe(true);
    expect(allText(nodes)).toContain('x = 1');
  });
});

describe('escaped markers stay literal', () => {
  // `escapeMarkdownText` protects a leading block marker in page text; the renderer
  // classifies blocks BEFORE undoing those escapes, so the line stays a paragraph and
  // the backslash never reaches the page.
  it.each([
    ['<p># not a heading</p>', '# not a heading'],
    ['<p>- not a bullet</p>', '- not a bullet'],
    ['<p>&gt; not a quote</p>', '> not a quote'],
    ['<p>1. not a list</p>', '1. not a list'],
    ['<p>--- not a rule</p>', '--- not a rule'],
  ])('keeps %s as one prose paragraph', (html, expected) => {
    const markdown = md(html);
    expect(markdown).toContain('\\');
    const nodes = render(markdown);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].text).toBe(expected);
  });
});

describe('the reported ChatGPT export', () => {
  // The body that produced the reported PDF: bold markers on the page, a quote block,
  // and a citation link with a favicon. Nothing Markdown-shaped may survive.
  const body = [
    '맞음. **아파트 분양계약을 체결할 때도 수입인지가 필요**함.',
    '',
    '> 수입인지 → **국가의 인지세** 납부',
    '',
    '- 계약금 납부',
    '- **전자수입인지 구매**',
    '',
    '[![](https://www.google.com/s2/favicons?domain=x&sz=128)국세법령정보시스템+1](https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=1)',
  ].join('\n');

  it('leaves no Markdown marker anywhere in the rendered tree', () => {
    const text = allText(render(body));
    for (const marker of ['**', '](', '![', '> ', '- ']) {
      expect(text).not.toContain(marker);
    }
  });

  it('carries the citation href onto a link run', () => {
    const flat = JSON.stringify(render(body));
    expect(flat).toContain('"link":"https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=1"');
    expect(flat).toContain('"bold":true');
  });

  it('is deterministic — the same body renders deep-equal twice', () => {
    expect(renderMarkdown(body)).toEqual(renderMarkdown(body));
  });
});
