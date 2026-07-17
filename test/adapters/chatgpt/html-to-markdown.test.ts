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
});
