import { describe, it, expect } from 'vitest';
import { escapeMarkdownBlock, escapeMarkdownText } from '../../src/core/markdown-escape';

describe('escapeMarkdownText', () => {
  describe('backslash', () => {
    it('escapes a literal backslash so it is not consumed as an escape', () => {
      // `a\*b` must survive as literal `a\*b`, not render `a*b`.
      expect(escapeMarkdownText('a\\*b')).toBe('a\\\\\\*b');
    });

    it('does not double a pre-existing backslash-bracket', () => {
      // `\[` used to become `\\[`; now the backslash is escaped first → `\\\[`,
      // which renders literal `\[`.
      expect(escapeMarkdownText('\\[')).toBe('\\\\\\[');
    });

    it('escapes a Windows path backslash', () => {
      expect(escapeMarkdownText('C:\\path')).toBe('C:\\\\path');
    });
  });

  describe('inline structure characters', () => {
    it('escapes backtick, open and close brackets anywhere', () => {
      expect(escapeMarkdownText('see [1] and `x`')).toBe('see \\[1\\] and \\`x\\`');
    });

    it('escapes a pipe (GFM table cell delimiter) at the source', () => {
      expect(escapeMarkdownText('a | b')).toBe('a \\| b');
    });

    it('escapes a pipe after a backslash without double-escaping the backslash', () => {
      // `a\|b`: backslash escaped first, then the pipe — renders literal `a\|b`.
      expect(escapeMarkdownText('a\\|b')).toBe('a\\\\\\|b');
    });
  });

  describe('emphasis and strikethrough (flanking)', () => {
    it('escapes surrounding emphasis asterisks', () => {
      expect(escapeMarkdownText('*emph*')).toBe('\\*emph\\*');
    });

    it('escapes surrounding emphasis underscores', () => {
      expect(escapeMarkdownText('_emph_')).toBe('\\_emph\\_');
    });

    it('escapes a strikethrough run', () => {
      expect(escapeMarkdownText('~~strike~~')).toBe('\\~\\~strike\\~\\~');
    });

    it('does NOT escape an intraword underscore (snake_case)', () => {
      expect(escapeMarkdownText('snake_case')).toBe('snake_case');
      expect(escapeMarkdownText('a_b_c')).toBe('a_b_c');
    });

    it('escapes intraword asterisks that CommonMark would read as emphasis', () => {
      // `2*3*4` would otherwise render `2<em>3</em>4`; escaping keeps it literal.
      expect(escapeMarkdownText('2*3*4')).toBe('2\\*3\\*4');
    });

    it('escapes a lone glob asterisk (accepted flanking-only over-escape)', () => {
      // Renders identically to `*.txt`; documents the cosmetic backslash.
      expect(escapeMarkdownText('*.txt')).toBe('\\*.txt');
    });

    it('treats full-width CJK punctuation as flanking context', () => {
      // `（ ）` (U+FF08/FF09) count as punctuation so the underscores flank and
      // are escaped, instead of rendering `_literal_` as emphasis after export.
      expect(escapeMarkdownText('（_literal_）')).toBe('（\\_literal\\_）');
    });

    it('still leaves an intraword underscore alone between CJK letters', () => {
      expect(escapeMarkdownText('한글_variable')).toBe('한글_variable');
    });

    it('escapes an edge delimiter against a threaded neighbor char', () => {
      // `_<span>literal</span>_`: each `_` is its own text node. Threading the
      // real neighbor ('l') across the inline boundary makes both flank and escape,
      // instead of the whitespace-sentinel default leaving them as emphasis.
      expect(escapeMarkdownText('_', false, ' ', 'l')).toBe('\\_');
      expect(escapeMarkdownText('_', false, 'l', ' ')).toBe('\\_');
    });

    it('leaves an edge delimiter alone when the threaded neighbor is whitespace', () => {
      // Default sentinels (standalone edge) — no flanking, no escape. Regression
      // guard: threading must not escape a genuinely non-flanking delimiter.
      expect(escapeMarkdownText('_', false, ' ', ' ')).toBe('_');
    });
  });

  describe('leading block markers (atLineStart)', () => {
    it('escapes leading bullet and heading markers only at line start', () => {
      expect(escapeMarkdownText('- item', true)).toBe('\\- item');
      expect(escapeMarkdownText('# head', true)).toBe('\\# head');
      expect(escapeMarkdownText('> quote', true)).toBe('\\> quote');
      expect(escapeMarkdownText('1. list', true)).toBe('1\\. list');
    });

    it('does not escape a leading marker mid-line', () => {
      expect(escapeMarkdownText('- item', false)).toBe('- item');
    });

    it('leaves a decimal alone', () => {
      expect(escapeMarkdownText('1.23 is a float', true)).toBe('1.23 is a float');
    });
  });
});

// Plain page text an adapter read with `textContent`. `Message.content` is Markdown by
// contract, so this text has to survive as the literal characters the reader saw.
describe('escapeMarkdownBlock', () => {
  it('escapes emphasis a user typed literally', () => {
    expect(escapeMarkdownBlock('**literal**')).toBe('\\*\\*literal\\*\\*');
  });

  it('escapes a block marker on every line, not just the first', () => {
    // The single-call form treats only the first line as a line start, which is right
    // for inline serialization and wrong for a multi-line pre-wrap block.
    expect(escapeMarkdownBlock('- one\n- two')).toBe('\\- one\n\\- two');
  });

  it('escapes a heading marker and an ordered-list marker per line', () => {
    expect(escapeMarkdownBlock('# note\n1. first')).toBe('\\# note\n1\\. first');
  });

  it('preserves blank lines so paragraph breaks survive', () => {
    expect(escapeMarkdownBlock('one\n\ntwo')).toBe('one\n\ntwo');
  });

  it('leaves text with nothing significant unchanged', () => {
    expect(escapeMarkdownBlock('just words\nand more')).toBe('just words\nand more');
  });
});
