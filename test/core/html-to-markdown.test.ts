import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { blockToMarkdown, htmlToMarkdown } from '../../src/core/html-to-markdown';

// Parse an HTML fragment into a prose-container element, the shape every adapter
// hands the serializer (ChatGPT's `.markdown`, Claude's `.standard-markdown`).
function md(html: string): string {
  const window = new Window();
  const container = window.document.createElement('div');
  container.innerHTML = html;
  return htmlToMarkdown(container as unknown as Element);
}

describe('htmlToMarkdown', () => {
  it('renders bold and italic inline', () => {
    expect(md('<p><strong>bold</strong> and <em>italic</em></p>')).toBe('**bold** and *italic*');
  });

  it('renders inline code', () => {
    expect(md('<p>call <code>print()</code> now</p>')).toBe('call `print()` now');
  });

  it('renders plain inline code with single backticks', () => {
    expect(md('<p><code>print()</code></p>')).toBe('`print()`');
  });

  it('escapes inline code that contains backticks', () => {
    // Content has a single backtick → fence widens to two backticks and pads with
    // spaces so the code stays valid Markdown (CommonMark).
    expect(md('<p><code>a`b</code></p>')).toBe('`` a`b ``');
  });

  it('renders links', () => {
    expect(md('<p>see <a href="https://example.com/">the site</a></p>')).toBe(
      'see [the site](https://example.com/)',
    );
  });

  it('renders headings by level', () => {
    expect(md('<h2>Title</h2>')).toBe('## Title');
  });

  it('renders unordered lists', () => {
    expect(md('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two');
  });

  it('renders ordered lists with incrementing numbers', () => {
    expect(md('<ol><li>first</li><li>second</li></ol>')).toBe('1. first\n2. second');
  });

  it('renders nested lists with indentation', () => {
    expect(md('<ul><li>parent<ul><li>child</li></ul></li></ul>')).toBe('- parent\n  - child');
  });

  it('renders a fenced code block with language from the header label', () => {
    const html =
      '<pre><div class="header"><svg></svg>Python<button>복사</button></div>' +
      '<code>def add(a, b):\n    return a + b</code></pre>';
    expect(md(html)).toBe('```python\ndef add(a, b):\n    return a + b\n```');
  });

  it('omits a bogus (non-language) code header label', () => {
    const html = '<pre><div>실행됨</div><code>ls</code></pre>';
    expect(md(html)).toBe('```\nls\n```');
  });

  // Claude tags the language on the <code> itself (verified live 2026-07-25:
  // class="language-sql") and renders no header label, so the class is the only source.
  it('reads the fence language from a standard language-xxx class', () => {
    const html = '<pre class="code-block__code"><code class="language-sql">SELECT 1;</code></pre>';
    expect(md(html)).toBe('```sql\nSELECT 1;\n```');
  });

  it('prefers the language-xxx class over a header label when both are present', () => {
    const html =
      '<pre><div class="header">Plain text</div>' +
      '<code class="language-ts">const x = 1;</code></pre>';
    expect(md(html)).toBe('```ts\nconst x = 1;\n```');
  });

  it('ignores unrelated classes on the code element', () => {
    const html = '<pre><code class="hljs whitespace-pre">ls</code></pre>';
    expect(md(html)).toBe('```\nls\n```');
  });

  it('falls back to the header label when the language class is empty or bogus', () => {
    const html =
      '<pre><div class="header">Python</div>' +
      '<code class="language-">def f(): pass</code></pre>';
    expect(md(html)).toBe('```python\ndef f(): pass\n```');
  });

  it('renders blockquotes with a prefix', () => {
    expect(md('<blockquote><p>quoted</p></blockquote>')).toBe('> quoted');
  });

  it('separates block elements with a blank line and is deterministic', () => {
    const html = '<p>first</p><p>second</p>';
    expect(md(html)).toBe('first\n\nsecond');
    expect(md(html)).toBe(md(html));
  });

  it('escapes a leading block marker in text so it is not read as structure', () => {
    expect(md('<p># not a heading</p>')).toBe('\\# not a heading');
    expect(md('<p>&gt; not a quote</p>')).toBe('\\> not a quote');
    expect(md('<p>- not a bullet</p>')).toBe('\\- not a bullet');
    expect(md('<p>* not a bullet</p>')).toBe('\\* not a bullet');
    expect(md('<p>+ not a bullet</p>')).toBe('\\+ not a bullet');
    expect(md('<p>1. not a list</p>')).toBe('1\\. not a list');
    expect(md('<p>2) not a list</p>')).toBe('2\\) not a list');
  });

  it('does not escape a decimal as an ordered-list marker', () => {
    // `1.23` is a number, not a list marker (no space after the dot).
    expect(md('<p>1.23 is a float</p>')).toBe('1.23 is a float');
    expect(md('<p>1.foo bar</p>')).toBe('1.foo bar');
  });

  it('does not over-escape a leading marker in a mid-paragraph text node', () => {
    // Text after an inline element is not at a line start, so its leading `-`
    // must not be treated as a bullet.
    expect(md('<p>This is <strong>bold</strong> - and not a bullet</p>')).toBe(
      'This is **bold** - and not a bullet',
    );
    expect(md('<p>See <a href="http://example.com">link</a> - or not</p>')).toBe(
      'See [link](http://example.com) - or not',
    );
  });

  it('escapes inline link/code characters in text', () => {
    expect(md('<p>see [1] for details</p>')).toBe('see \\[1\\] for details');
    expect(md('<p>type `ls` to list</p>')).toBe('type \\`ls\\` to list');
  });

  it('escapes literal emphasis delimiters straddling an inline element', () => {
    // `_<span>literal</span>_`: the two underscores are separate text nodes. The
    // neighbor char ('l') is threaded across the inline boundary so both flank and
    // escape, instead of round-tripping into emphasis after export.
    expect(md('<p>_<span>literal</span>_</p>')).toBe('\\_literal\\_');
  });

  it('does not escape intraword underscores next to inline elements', () => {
    expect(md('<p><strong>foo</strong>_bar</p>')).toBe('**foo**_bar');
    expect(md('<p>foo_<strong>bar</strong></p>')).toBe('foo_**bar**');
  });

  it('does not over-escape real HTML formatting', () => {
    // Serializer-generated markers (##, **, `, - ) must stay unescaped.
    expect(md('<h1>Title</h1>')).toBe('# Title');
    expect(md('<p><strong>bold</strong></p>')).toBe('**bold**');
    expect(md('<p><code>ls</code></p>')).toBe('`ls`');
    expect(md('<ul><li>item</li></ul>')).toBe('- item');
  });

  describe('list items with block content', () => {
    it('renders a fenced code block nested in a list item as a real block', () => {
      const html =
        '<ul><li>text<pre><div>Python<button>copy</button></div>' +
        '<code>x = 1</code></pre></li></ul>';
      expect(md(html)).toBe('- text\n\n  ```python\n  x = 1\n  ```');
    });

    it('separates multiple paragraphs in one list item', () => {
      expect(md('<ul><li><p>first para</p><p>second para</p></li></ul>')).toBe(
        '- first para\n\n  second para',
      );
    });

    it('unwraps a div/section wrapper so its block children survive', () => {
      // A <div> around block content inside <li> is not a list-block tag, but it
      // has block descendants → routed through block serialization instead of
      // flattening its <p>/<pre> onto the marker line.
      const html =
        '<ul><li><div><p>first</p><p>second</p>' +
        '<pre><code>x = 1</code></pre></div></li></ul>';
      expect(md(html)).toBe('- first\n\n  second\n\n  ```\n  x = 1\n  ```');
    });

    it('handles nested lists wrapped in a div correctly', () => {
      const html = '<ul><li><div><ul><li>child</li></ul></div></li></ul>';
      expect(md(html)).toBe('-\n  - child');
    });

    it('honors <ol start="N">', () => {
      expect(md('<ol start="3"><li>c</li><li>d</li></ol>')).toBe('3. c\n4. d');
    });

    it('keeps text following a nested list on its own continuation line', () => {
      expect(md('<ul><li>parent<ul><li>child</li></ul>after</li></ul>')).toBe(
        '- parent\n  - child\n\n  after',
      );
    });

    it('indents a nested list to the full width of a wide ordered marker', () => {
      // `10. ` is 4 chars wide, so the nested child needs 4 spaces (not a fixed 2)
      // or CommonMark reads it as an outer list.
      expect(md('<ol start="10"><li>parent<ul><li>child</li></ul></li></ol>')).toBe(
        '10. parent\n    - child',
      );
    });

    it('ignores a negative <ol start> (not a valid marker)', () => {
      expect(md('<ol start="-5"><li>a</li></ol>')).toBe('1. a');
    });
  });

  describe('tables', () => {
    it('renders a GFM table with header, separator, and body rows', () => {
      const html =
        '<table><thead><tr><th>H1</th><th>H2</th></tr></thead>' +
        '<tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>';
      expect(md(html)).toBe('| H1 | H2 |\n| --- | --- |\n| a | b |\n| c | d |');
    });

    it('escapes a pipe inside a cell and uses the first row as the header', () => {
      expect(md('<table><tr><td>a|b</td><td>c</td></tr></table>')).toBe(
        '| a\\|b | c |\n| --- | --- |',
      );
    });

    it('serializes inline formatting inside a cell', () => {
      expect(md('<table><tr><th>h</th></tr><tr><td><strong>x</strong></td></tr></table>')).toBe(
        '| h |\n| --- |\n| **x** |',
      );
    });

    it('widens the grid to the widest row instead of dropping cells', () => {
      // A body row wider than the header must not silently lose its last cell.
      expect(md('<table><tr><th>h</th></tr><tr><td>a</td><td>b</td></tr></table>')).toBe(
        '| h |  |\n| --- | --- |\n| a | b |',
      );
    });

    it('does not pull a nested table’s rows into the outer grid', () => {
      const html =
        '<table><tr><td>outer' +
        '<table><tr><td>inner</td></tr></table>' +
        '</td><td>x</td></tr></table>';
      // Outer table has one row of two cells; the inner table's row does NOT
      // leak into the outer grid (it is flattened inline within the cell).
      expect(md(html)).toBe('| outerinner | x |\n| --- | --- |');
    });
  });
});

// `htmlToMarkdown` treats its argument as a *container* of blocks. When the element to
// render IS the block — a `<ul>` lifted straight out of a Claude user turn — that drops
// the list markers, so adapters use `blockToMarkdown` for it instead.
describe('blockToMarkdown', () => {
  function block(html: string): string {
    const window = new Window();
    const holder = window.document.createElement('div');
    holder.innerHTML = html;
    return blockToMarkdown(holder.firstElementChild as unknown as Element);
  }

  it('keeps the markers of a list passed in directly', () => {
    expect(block('<ul><li>alpha</li><li>beta</li></ul>')).toBe('- alpha\n- beta');
  });

  it('numbers an ordered list passed in directly', () => {
    expect(block('<ol><li>one</li><li>two</li></ol>')).toBe('1. one\n2. two');
  });

  it('differs from htmlToMarkdown on the same element (the bug this exists to avoid)', () => {
    const html = '<ul><li>alpha</li><li>beta</li></ul>';
    const window = new Window();
    const holder = window.document.createElement('div');
    holder.innerHTML = html;
    const list = holder.firstElementChild as unknown as Element;
    expect(htmlToMarkdown(list)).toBe('alpha\n\nbeta'); // markers lost
    expect(blockToMarkdown(list)).toBe('- alpha\n- beta');
  });

  it('serializes a non-list block just as the container path would', () => {
    expect(block('<p>plain <strong>text</strong></p>')).toBe('plain **text**');
  });
});

// Four fidelity defects the PR #77/#78 review panels found: source the serializer
// emitted that no longer means what the page showed. Each is fixed here, at the
// serializer, because the Markdown export carries the same corruption the PDF
// renderer does.
describe('serialization fidelity', () => {
  it('collapses a newline inside inline code so the span stays on one line', () => {
    // A code span is single-line in Markdown: left as-is, the closing fence lands on
    // another line where nothing pairs it and the backticks print as literal text.
    expect(md('<p>x <code>a\nb</code> y</p>')).toBe('x `a b` y');
  });

  it('merges two touching code spans into one', () => {
    // `` `k` `` + `` `k` `` reads back as a single span holding ``k``, and no fence
    // length repairs it — CommonMark pairs runs of equal length.
    expect(md('<p><code>k</code><code>k</code></p>')).toBe('`kk`');
  });

  it('merges a run of three touching code spans', () => {
    expect(md('<p><code>a</code><code>b</code><code>c</code></p>')).toBe('`abc`');
  });

  it('keeps code spans separate when visible text sits between them', () => {
    expect(md('<p><code>k</code> <code>k</code></p>')).toBe('`k` `k`');
  });

  it('escapes a pipe inside inline code inside a table cell', () => {
    // The code body is deliberately never escaped, so without a cell-level pass this
    // bare `|` splits the row and tears the code span in two.
    expect(md('<table><tr><td><code>a|b</code></td><td>c</td></tr></table>')).toBe(
      '| `a\\|b` | c |\n| --- | --- |',
    );
  });

  it('does not double-escape a pipe a text node already escaped', () => {
    expect(md('<table><tr><td>x | y</td></tr></table>')).toBe('| x \\| y |\n| --- |');
  });

  it('wraps a link destination holding an unbalanced paren in angle brackets', () => {
    // Bare, the destination is read up to the first unbalanced `)` and the URL is
    // silently truncated.
    expect(md('<p><a href="https://e.com/a)b">t</a></p>')).toBe('[t](<https://e.com/a)b>)');
  });

  it('percent-encodes whitespace in a link destination rather than wrapping it', () => {
    // The angle form does not rescue whitespace: CommonMark forbids a newline inside
    // it, and the PDF renderer re-splits the document on newlines, so a wrapped
    // destination would break the link across two lines.
    expect(md('<p><a href="https://e.com/a b">t</a></p>')).toBe('[t](https://e.com/a%20b)');
    expect(md('<p><a href="https://e.com/a\nb">t</a></p>')).toBe('[t](https://e.com/a%20b)');
  });

  it('percent-encodes whitespace and still wraps an unbalanced paren', () => {
    expect(md('<p><a href="https://e.com/a b)c">t</a></p>')).toBe('[t](<https://e.com/a%20b)c>)');
  });

  it('drops a whitespace-only destination instead of linking to it', () => {
    expect(md('<p><a href="   ">t</a></p>')).toBe('t');
  });

  it('leaves a destination with balanced parens bare', () => {
    expect(md('<p><a href="https://e.com/a(b)c">t</a></p>')).toBe('[t](https://e.com/a(b)c)');
  });

  it('wraps an image destination holding an unbalanced paren in angle brackets', () => {
    // The `img` src needs the same treatment as an `a` href: bare, it truncates at the
    // first unbalanced `)` and the reader loses the rest of the URL.
    expect(md('<p><img src="https://e.com/a)b" alt="x"></p>')).toBe('![x](<https://e.com/a)b>)');
  });

  it('percent-encodes whitespace in an image destination', () => {
    expect(md('<p><img src="https://e.com/a b" alt="x"></p>')).toBe('![x](https://e.com/a%20b)');
  });

  it('keeps the alt text of an image whose src is whitespace only', () => {
    // No destination survives the trim, so the markup goes — but the alt is what the
    // browser showed for that broken image, and it is escaped on the way out because
    // it is prose now rather than a bracketed label.
    expect(md('<p><img src="   " alt="a [chart]"></p>')).toBe('a \\[chart\\]');
    expect(md('<p><img src="   " alt=""></p>')).toBe('');
  });

  it('escapes a block marker in the alt text of a destination-less image', () => {
    // The fallback starts its paragraph, so an alt of `- item` would export as a list
    // and a multi-line alt could start a marker on the second line.
    expect(md('<p><img src="   " alt="- item"></p>')).toBe('\\- item');
    expect(md('<p><img src="   " alt="# head"></p>')).toBe('\\# head');
    expect(md('<p><img src="   " alt="a&#10;- b"></p>')).toBe('a - b');
  });

  it('leaves a destination containing an angle bracket bare rather than corrupting it', () => {
    // A bare destination may hold angle brackets — only the wrapper is closed early by them,
    // and balanced parens mean no wrapper is needed here.
    expect(md('<p><a href="https://e.com/a>b c">t</a></p>')).toBe('[t](https://e.com/a>b%20c)');
  });

  it('percent-encodes an angle bracket when the destination must be wrapped', () => {
    // Both defects at once: the unbalanced `)` forces the angle wrapper, and a `>` inside
    // would close that wrapper early. Neither bare nor wrapped survives as written, so the
    // `>` is percent-encoded and the wrapper does its job.
    expect(md('<p><a href="https://e.com/a>b)c">t</a></p>')).toBe('[t](<https://e.com/a%3Eb)c>)');
    expect(md('<p><img src="https://e.com/a>b)c" alt="q"></p>')).toBe('![q](<https://e.com/a%3Eb)c>)');
    expect(md('<p><a href="https://e.com/a<b)c">t</a></p>')).toBe('[t](<https://e.com/a%3Cb)c>)');
  });

  it('percent-encodes a pipe in a destination inside a table cell', () => {
    // A GFM row is split on its unescaped `|` before any inline parsing, so a pipe in a
    // destination tears the row. The destination is emitted after the cell-text escaping
    // decision, so it encodes its own.
    expect(md('<table><tr><td><img src="https://e.com/a|b" alt="z"></td></tr></table>')).toBe(
      '| ![z](https://e.com/a%7Cb) |\n| --- |',
    );
    expect(md('<table><tr><td><a href="https://e.com/a|b">t</a></td></tr></table>')).toBe(
      '| [t](https://e.com/a%7Cb) |\n| --- |',
    );
  });

  it('leaves a pipe in a destination alone outside a table', () => {
    expect(md('<p><a href="https://e.com/a|b">t</a></p>')).toBe('[t](https://e.com/a|b)');
  });

  it('percent-encodes a backslash when the destination must be wrapped', () => {
    // Inside the angle form a `\` escapes the punctuation after it, so a destination
    // ending in one swallows the closing `>` and the link never terminates.
    expect(md('<p><a href="https://e.com/a)b\\">t</a></p>')).toBe('[t](<https://e.com/a)b%5C>)');
    // A non-terminal one is eaten just as quietly: `\-` reads back as `-`.
    expect(md('<p><a href="https://e.com/a)b\\-c">t</a></p>')).toBe('[t](<https://e.com/a)b%5C-c>)');
  });

  it('percent-encodes a backslash in a bare destination too', () => {
    // The balanced-paren path returns before the wrapper's encoding, so a `\` used to
    // reach the reader intact — and a CommonMark reader resolves `\%` to a literal `%`,
    // dropping the backslash and silently changing the destination the page carried.
    expect(md('<p><a href="https://e.com/a\\-b">t</a></p>')).toBe('[t](https://e.com/a%5C-b)');
    expect(md('<table><tr><td><a href="https://e.com/a\\|b">t</a></td></tr></table>')).toBe(
      '| [t](https://e.com/a%5C%7Cb) |\n| --- |',
    );
  });

  it('wraps a destination that starts with an angle bracket', () => {
    // CommonMark forbids a bare destination from starting with `<`, and the unclosed
    // angle form fails too, so the position-0 case has no valid spelling until the
    // wrapper takes it and percent-encodes the bracket.
    expect(md('<p><a href="<https://e.com/a">t</a></p>')).toBe('[t](<%3Chttps://e.com/a>)');
    expect(md('<p><img src="<https://e.com/a" alt="q"></p>')).toBe('![q](<%3Chttps://e.com/a>)');
  });

  it('escapes an image alt that sits beside a usable destination', () => {
    // The alt is display text inside `![...]`, so it corrupts the markup around it exactly
    // as an unescaped destination did: a `|` splits the row it sits in, and a `[`/`]`
    // breaks the image out of its own brackets.
    expect(md('<table><tr><td><img src="https://e.com/a" alt="x|y"></td></tr></table>')).toBe(
      '| ![x\\|y](https://e.com/a) |\n| --- |',
    );
    expect(md('<p><img src="https://e.com/a" alt="a]b"></p>')).toBe('![a\\]b](https://e.com/a)');
    // A line break inside the alt would leave the closing `]` on a later line.
    expect(md('<p><img src="https://e.com/a" alt="a&#10;b"></p>')).toBe('![a b](https://e.com/a)');
  });

  it('escapes an anchor label that falls back to the href', () => {
    // An anchor whose content is an icon serializes to no label and the href stands in
    // for it. As visible text it is prose: a `|` would split the row it sits in, and a
    // bracket or backtick would corrupt the markup around it.
    expect(md('<table><tr><td><a href="https://e.com/a|b"></a></td></tr></table>')).toBe(
      '| [https://e.com/a\\|b](https://e.com/a%7Cb) |\n| --- |',
    );
    expect(md('<p><a href="https://e.com/a[b]c"></a></p>')).toBe(
      '[https://e.com/a\\[b\\]c](https://e.com/a[b]c)',
    );
  });
});

// Regressions the PR #82 review panel found in the first pass of these fixes.
describe('serialization fidelity — review-panel regressions', () => {
  it('merges code spans separated only by an element that renders nothing', () => {
    // A provider wraps inline code in a span far more often than it emits bare
    // sibling `<code>`s, so a merge that only saw direct siblings still produced the
    // unreadable `` `k``k` `` on the markup these pages actually ship.
    expect(md('<p><code>k</code><span></span><code>k</code></p>')).toBe('`kk`');
    expect(md('<p><code>k</code><span><code>k</code></span></p>')).toBe('`kk`');
    expect(md('<p><span><code>k</code></span><span><code>k</code></span></p>')).toBe('`kk`');
    expect(md('<p><code>k</code><em></em><code>k</code></p>')).toBe('`kk`');
  });

  it('merges code spans a wrapper only partly holds', () => {
    // The wrapper shows the reader nothing of its own, so what the page displays is
    // one continuous run of code followed by text — an all-or-nothing \u201cis this
    // element only code?\u201d test still emitted the unreadable form here.
    expect(md('<p><code>k</code><span><code>k</code> x</span></p>')).toBe('`kk` x');
    expect(md('<p><span>lead <code>a</code></span><code>b</code></p>')).toBe('lead `ab`');
    expect(md('<p><code>a</code><span><code>b</code><code>c</code> tail</span></p>')).toBe(
      '`abc` tail',
    );
  });

  it('merges through a wrapper tag no allowlist would have named', () => {
    // Wrappers are open-ended \u2014 a provider can ship any inline tag \u2014 so the rule is
    // stated as the tags that render markup of their own, not as a list of wrappers.
    expect(md('<p><code>k</code><mark><code>k</code></mark></p>')).toBe('`kk`');
    expect(md('<p><code>k</code><sup><code>k</code></sup></p>')).toBe('`kk`');
  });

  it('still separates code spans an element with real content sits between', () => {
    expect(md('<p><code>a</code><em>x</em><code>b</code></p>')).toBe('`a`*x*`b`');
    expect(md('<p><code>a</code><span>x</span><code>b</code></p>')).toBe('`a`x`b`');
    // Real formatting between them IS a separator: the emphasis is content.
    expect(md('<p><code>a</code><em><code>b</code></em></p>')).toBe('`a`*`b`*');
  });

  it('keeps a code body\u2019s spaces and tabs, collapsing only its line breaks', () => {
    // A code body is literal text: collapsing its space runs would silently reformat
    // the code the reader saw.
    expect(md('<p><code>a  b</code></p>')).toBe('`a  b`');
    expect(md('<p><code>a\tb</code></p>')).toBe('`a\tb`');
    expect(md('<p><code>a\nb</code></p>')).toBe('`a b`');
  });

  it('keeps a backslash that precedes a pipe inside table-cell code', () => {
    // The reader consumes backslashes in pairs, so the run in front of the pipe is
    // doubled and the escape lands on the pipe itself.
    expect(md('<table><tr><td><code>a\\|b</code></td></tr></table>')).toBe(
      '| `a\\\\\\|b` |\n| --- |',
    );
  });

  it('leaves a backslash that precedes no pipe in table-cell code alone', () => {
    expect(md('<table><tr><td><code>C:\\path</code></td></tr></table>')).toBe(
      '| `C:\\path` |\n| --- |',
    );
  });

  it('does not escape pipes in code outside a table', () => {
    expect(md('<p><code>a|b</code></p>')).toBe('`a|b`');
  });
});
