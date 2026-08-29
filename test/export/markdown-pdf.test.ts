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

  it('drops a paragraph that renders to nothing rather than emitting a blank node', () => {
    const markdown = md('<p><img src="https://cdn.example/icon.png" alt=""></p>');
    expect(markdown).toBe('![](https://cdn.example/icon.png)');
    expect(render(markdown)).toEqual([]);
  });

  it('shows an href fallback label verbatim instead of re-parsing it as Markdown', () => {
    const url = 'http://x/a*b*c';
    expect(runs(`[](${url})`)).toEqual([{ text: url, link: url, style: 'link' }]);
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

  // A `<br>` inside emphasis serializes to a literal newline BETWEEN the delimiters,
  // and the paragraph keeps that soft break in one node — so refusing to pair across
  // it is what left `**` on the page. Pairing is still bounded by the paragraph: a
  // blank line ends the block upstream of the inline scan.
  it('pairs emphasis across the soft line break a <br> produces', () => {
    const markdown = md('<p><strong>alpha<br>beta</strong> tail</p>');
    expect(markdown).toBe('**alpha\nbeta** tail');
    expect(runs(markdown)).toEqual([{ text: 'alpha\nbeta', bold: true }, { text: ' tail' }]);
  });

  it('does not pair a delimiter whose body starts with whitespace', () => {
    expect(runs('a * b\nc * d')).toBe('a * b\nc * d');
  });

  // `<em>` wrapping `<strong>`: the closer must be a run of exactly the opening
  // length, or the inner `**` ends the italic span and its markers reach the page.
  it('nests strong inside emphasis', () => {
    const markdown = md('<p><em>a <strong>b</strong> c</em></p>');
    expect(markdown).toBe('*a **b** c*');
    expect(runs(markdown)).toEqual([
      { text: 'a ', italics: true },
      { text: 'b', bold: true, italics: true },
      { text: ' c', italics: true },
    ]);
  });

  it('renders a ***both*** run as bold and italic, with no stray asterisk', () => {
    const markdown = md('<p><strong><em>x</em></strong></p>');
    expect(markdown).toBe('***x***');
    expect(runs(markdown)).toEqual([{ text: 'x', bold: true, italics: true }]);
  });

  // Two adjacent inline elements with no text between them serialize to one merged
  // delimiter run: the `**` closing the strong and the `*` opening the em collide.
  it('splits the merged delimiter run of two adjacent emphasis elements', () => {
    const markdown = md('<p><strong>a</strong><em>b</em></p>');
    expect(markdown).toBe('**a***b*');
    expect(runs(markdown)).toEqual([{ text: 'a', bold: true }, { text: 'b', italics: true }]);
  });

  // The regression the two-pass scan this replaced introduced: an exact-width closer
  // search reached past the adjacent run into the closer of a LATER element.
  it('does not let a later element close an adjacent emphasis run', () => {
    const markdown = md('<p><strong>a</strong><em>b</em> <strong>c</strong></p>');
    expect(markdown).toBe('**a***b* **c**');
    expect(runs(markdown)).toEqual([
      { text: 'a', bold: true },
      { text: 'b', italics: true },
      { text: ' ' },
      { text: 'c', bold: true },
    ]);
  });

  it('keeps nesting intact when another emphasis follows in the same paragraph', () => {
    const markdown = md('<p><em>a <strong>b</strong> c</em> and <em>d</em></p>');
    expect(markdown).toBe('*a **b** c* and *d*');
    expect(runs(markdown)).toEqual([
      { text: 'a ', italics: true },
      { text: 'b', bold: true, italics: true },
      { text: ' c', italics: true },
      { text: ' and ' },
      { text: 'd', italics: true },
    ]);
  });

  // Emphasis closing at the very end of an outer span merges the two closers into one
  // run; the split has to leave the inner one its asterisks, not take them first.
  it.each([
    ['<p><em>a <strong>b</strong></em></p>', '*a **b***', { italics: true }, { bold: true, italics: true }],
    ['<p><strong>a <em>b</em></strong></p>', '**a *b***', { bold: true }, { bold: true, italics: true }],
  ])('closes %s without leaking the inner delimiters', (html, source, outer, inner) => {
    const markdown = md(html);
    expect(markdown).toBe(source);
    expect(runs(markdown)).toEqual([{ text: 'a ', ...outer }, { text: 'b', ...inner }]);
  });

  // Two adjacent elements with the SAME tag merge into an even-width run, which a
  // width-matching closer would step over entirely.
  it.each([
    ['<p><strong>a</strong><strong>b</strong></p>', '**a****b**', { bold: true }],
    ['<p><em>a</em><em>b</em></p>', '*a**b*', { italics: true }],
  ])('splits the merged run of two adjacent %s elements', (html, source, marks) => {
    const markdown = md(html);
    expect(markdown).toBe(source);
    expect(runs(markdown)).toEqual([{ text: 'a', ...marks }, { text: 'b', ...marks }]);
  });

  // An asterisk divider line: `escapeMarkdownText` protects only the leading `*`, so
  // the rest arrives bare and used to be swallowed as delimiters.
  it('keeps an asterisk divider line intact', () => {
    const markdown = md('<p>**********</p>');
    expect(markdown).toBe('\\**********');
    expect(runs(markdown)).toBe('**********');
  });

  // An asterisk inside a code span, a URL or an image source is content. The
  // emphasis scan has to step over those atoms whole or it consumes the real closer.
  it.each([
    ['<p><strong>a <code>x*y</code> b</strong></p>', '**a `x*y` b**'],
    ['<p><em>a <code>p*q</code></em></p>', '*a `p*q`*'],
    ['<p><strong>a <a href="https://e.com/x*y">L</a> b</strong></p>', '**a [L](https://e.com/x*y) b**'],
  ])('does not read an asterisk inside %s as a delimiter', (html, source) => {
    const markdown = md(html);
    expect(markdown).toBe(source);
    const rendered = runs(markdown) as Array<Record<string, unknown>>;
    expect(rendered.every((r) => r.bold === true || r.italics === true)).toBe(true);
    expect(allText(rendered)).not.toContain('`');
    expect(allText(rendered)).not.toContain('](');
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

  it('keeps a heading with a <br> on one line, emphasis intact', () => {
    const markdown = md('<h2><strong>a<br>b</strong></h2>');
    expect(markdown).toBe('## **a b**');
    expect(render(markdown)).toEqual([{ text: [{ text: 'a b', bold: true }], style: 'h2' }]);
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

  // The serializer emits a marker on its own line for an empty <li> and for an <li>
  // whose first content is a nested list. Requiring a space after the marker split
  // the list in two and printed the marker as prose.
  it('keeps a bare marker line inside its list', () => {
    const markdown = md('<ul><li><ul><li>child</li></ul></li></ul>');
    expect(markdown).toBe('-\n  - child');
    const nodes = render(markdown);
    expect(nodes).toHaveLength(1);
    expect(allText(nodes[0])).toBe('child');
    expect(JSON.stringify(nodes)).not.toContain('"text":"-"');
  });

  it('keeps an empty ordered item so the numbering does not restart', () => {
    const markdown = md('<ol><li></li><li>b</li></ol>');
    expect(markdown).toBe('1.\n2. b');
    const nodes = render(markdown);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].ol).toHaveLength(2);
    expect(nodes[0].start).toBeUndefined();
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

  // `escapeMarkdownText` leaves a non-flanking `_` alone, so an underscore-only line
  // arrives here unescaped. Treating it as a rule replaced the text with a line.
  it('keeps a literal underscore-only line as text, not a rule', () => {
    const markdown = md('<p>___</p>');
    expect(markdown).toBe('___');
    expect(render(markdown)).toEqual([{ text: '___', margin: [0, 2, 0, 2] }]);
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

// The renderer half of the PR #77/#78 fidelity fixes. Driven through the real
// serializer wherever it can emit the shape, per the note at the top of this file.
describe('serializer/renderer fidelity', () => {
  it('pairs an inline code span whose source held a newline', () => {
    const markdown = md('<p>x <code>a\nb</code> y</p>');
    expect(markdown).toBe('x `a b` y');
    expect(runs(markdown)).toEqual([
      { text: 'x ' },
      { text: 'a b', style: 'inlineCode' },
      { text: ' y' },
    ]);
  });

  it('keeps two touching code spans as one code run instead of splitting them', () => {
    const markdown = md('<p><code>k</code><code>k</code></p>');
    expect(runs(markdown)).toEqual([{ text: 'kk', style: 'inlineCode' }]);
  });

  it('keeps a pipe inside inline code inside a table cell in its own column', () => {
    const markdown = md('<table><tr><th>h</th></tr><tr><td><code>a|b</code></td></tr></table>');
    const [table] = render(markdown);
    const body = (table.table as Node).body as Node[][];
    // One column, not two: the escaped pipe is content, and the backslash the escape
    // added is table syntax that must not reach the page.
    expect(body[1]).toHaveLength(1);
    expect(allText(table)).toBe('ha|b');
  });

  it('follows a link destination that holds an unbalanced paren to its full length', () => {
    const markdown = md('<p><a href="https://e.com/a)b">t</a></p>');
    expect(markdown).toBe('[t](<https://e.com/a)b>)');
    expect(runs(markdown)).toEqual([{ text: 't', link: 'https://e.com/a)b', style: 'link' }]);
  });

  it('shows a table whose every cell is empty instead of dropping it', () => {
    // `tableNode` cannot build a grid with zero columns, but a silently vanished
    // block is the empty output Golden Principle #4 rules out — so the rows fall
    // through to prose and the reader still sees them. Hand-written: the serializer
    // does not emit this shape.
    const nodes = render('|\n| --- |');
    expect(nodes).toHaveLength(1);
    expect(allText(nodes)).toContain('|');
  });
});

// Regressions the PR #82 review panel found in the first pass of these fixes.
describe('serializer/renderer fidelity — review-panel regressions', () => {
  it('keeps a backslash that precedes a pipe inside table-cell code', () => {
    // The first pass escaped over the finished cell string, which cannot tell a
    // backslash escapeMarkdownText added from one the page showed — the renderer then
    // stripped the page's own backslash. Escape and undo now mirror each other.
    const markdown = md('<table><tr><th>h</th></tr><tr><td><code>a\\|b</code></td></tr></table>');
    const [table] = render(markdown);
    const body = (table.table as Node).body as Node[][];
    expect(body[1]).toHaveLength(1);
    expect(allText(table)).toBe('ha\\|b');
  });

  it('keeps a backslash that precedes no pipe inside table-cell code', () => {
    const markdown = md('<table><tr><th>h</th></tr><tr><td><code>C:\\path</code></td></tr></table>');
    expect(allText(render(markdown))).toBe('hC:\\path');
  });

  it('keeps two backslashes before a pipe inside table-cell code', () => {
    const markdown = md('<table><tr><th>h</th></tr><tr><td><code>a\\\\|b</code></td></tr></table>');
    const [table] = render(markdown);
    expect((((table.table as Node).body as Node[][])[1])).toHaveLength(1);
    expect(allText(table)).toBe('ha\\\\|b');
  });

  it('leaves a code span outside a table unescaped', () => {
    const markdown = md('<p><code>a\\|b</code></p>');
    expect(runs(markdown)).toEqual([{ text: 'a\\|b', style: 'inlineCode' }]);
  });

  it('does not print the delimiter row when an unbuildable table falls back to prose', () => {
    // `| --- |` is layout, not content — the fallback must leave it out the way the
    // table path does.
    const nodes = render('|\n| --- |');
    expect(nodes).toHaveLength(1);
    expect(allText(nodes)).toBe('|');
  });

  it('merges code spans a provider wrapped in spans', () => {
    const markdown = md('<p><span><code>k</code></span><span><code>k</code></span></p>');
    expect(runs(markdown)).toEqual([{ text: 'kk', style: 'inlineCode' }]);
  });

  it('consumes an angle-wrapped image destination whole', () => {
    // The serializer wraps an unbalanced-paren src the way it wraps an href; the
    // renderer must follow it to the closing `)` instead of stopping inside the URL
    // and leaking `>)` into the prose.
    const markdown = md('<p>before <img src="https://e.com/a)b" alt="a chart"> after</p>');
    expect(markdown).toBe('before ![a chart](<https://e.com/a)b>) after');
    expect(allText(render(markdown))).toBe('before a chart after');
  });

  it('keeps a code span whose body ends with a backslash', () => {
    // CommonMark has no escapes inside a code span, so the closing backtick pairs even
    // when a backslash precedes it. Hits Windows paths, LaTeX and regexes.
    const markdown = md('<p>path <code>C:\\</code> end</p>');
    expect(runs(markdown)).toEqual([
      { text: 'path ' },
      { text: 'C:\\', style: 'inlineCode' },
      { text: ' end' },
    ]);
  });

  it('still refuses to open or close a span on an escaped backtick', () => {
    // `\`` in prose is a literal backtick the reader saw, not a delimiter.
    expect(allText(render('a \\` b \\` c'))).toBe('a ` b ` c');
  });

  it('still refuses a closing run longer than the opening one', () => {
    // CommonMark pairs equal-length runs only; `` ` `` never closes against ``` `` ```.
    expect(allText(render('a `b`` c'))).toBe('a `b`` c');
  });
});
