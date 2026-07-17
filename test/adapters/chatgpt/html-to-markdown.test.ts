import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { htmlToMarkdown } from '../../../src/adapters/chatgpt/html-to-markdown';

// Parse an HTML fragment into a `.markdown`-style container element.
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
