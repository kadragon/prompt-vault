import { describe, it, expect } from 'vitest';
import { conversation } from '../fixtures/conversation';
import { createShareCopy, findShareCandidates } from '../../src/core/share-copy';
import type { Conversation } from '../../src/core/conversation';
import { toMarkdown } from '../../src/export/markdown';
import { escapeMarkdownText } from '../../src/core/markdown-escape';

const NEUTRAL = 'Shared conversation';

function single(content: string): Conversation {
  return conversation({ messages: [{ role: 'user', content }] });
}

function texts(content: string): string[] {
  return findShareCandidates(single(content)).map((c) => c.text);
}

function share(
  content: string,
  options: Partial<Parameters<typeof createShareCopy>[1]> = {},
): string {
  const copy = createShareCopy(single(content), {
    excluded: [],
    manualTerms: [],
    neutralTitle: NEUTRAL,
    ...options,
  });
  return copy.messages[0].content;
}

describe('findShareCandidates', () => {
  it('reports an email with its kind, text, message index and offsets', () => {
    const conv = conversation({
      messages: [
        { role: 'user', content: 'nothing here' },
        { role: 'assistant', content: 'mail jane.doe+x@example.co.kr now' },
      ],
    });
    expect(findShareCandidates(conv)).toEqual([
      { kind: 'email', text: 'jane.doe+x@example.co.kr', messageIndex: 1, start: 5, end: 29 },
    ]);
  });

  it('does not include a trailing sentence period in an email', () => {
    expect(texts('Write to a@b.com.')).toEqual(['a@b.com']);
  });

  it.each([
    ['010-1234-5678'],
    ['02.123.4567'],
    ['010 1234 5678'],
    ['031-123-4567'],
    ['+82 10-1234-5678'],
    ['+1 415 555 2671'],
    ['+1-800-555-0199'],
    ['+442071838750'],
    ['010-12345678'],
    ['(02) 123-4567'],
    ['(031)123-4567'],
  ])('detects the phone number %s', (phone) => {
    const found = findShareCandidates(single(`call ${phone} today`));
    expect(found).toEqual([
      { kind: 'phone', text: phone, messageIndex: 0, start: 5, end: 5 + phone.length },
    ]);
  });

  it.each([
    ['a bare mobile digit run', '01012345678'],
    ['an ISO date', '2026-10-27'],
    ['a dotted date', '2026.10.27'],
    ['an order id', 'order 123456789012'],
    ['an amount', '1,234,567 KRW'],
    ['a version', 'v1.13.5'],
    ['fraction digits after a decimal point', 'p=0.05 12345678'],
    ['a 00-prefixed id', 'id 00-1234567'],
  ])('leaves %s alone', (_label, content) => {
    expect(texts(content)).toEqual([]);
  });

  it('does not report a phone inside a longer digit run', () => {
    expect(texts('id 9010-1234-56789')).toEqual([]);
  });

  it.each([
    ['john_@corp.com'],
    ['__john__@corp.com'],
    ['kim~lee@corp.com'],
    ['x*y@corp.com'],
    ['a|b@corp.com'],
  ])('takes the whole escaped local part of %s as the adapter emits it', (raw) => {
    // Content is adapter Markdown: run the real escaper rather than hand-writing backslashes.
    const escaped = escapeMarkdownText(raw);
    expect(escaped).not.toBe(raw);
    expect(texts(`mail ${escaped} now`)).toEqual([escaped]);
    expect(share(`mail ${escaped} now`)).toBe('mail [EMAIL] now');
  });

  it('detects phones in CSV rows, where a digit and a comma precede the number', () => {
    expect(share('```csv\nid,phone\n1,010-1234-5678\n2,02-123-4567\n```')).toBe(
      '```csv\nid,phone\n1,[PHONE]\n2,[PHONE]\n```',
    );
  });

  it.each([
    ['x*y@corp.com'],
    ['kim~lee@corp.com'],
    ['a|b@corp.com'],
    ["o'brien@corp.com"],
    ['a**b@corp.com'],
    ['x||y@corp.com'],
  ])('takes the whole raw local part of %s inside a code block, where nothing is escaped', (raw) => {
    expect(share(`\`\`\`\nTO=${raw}\n\`\`\``)).toBe('```\nTO=[EMAIL]\n```');
  });

  it.each([
    ['**a@b.com**', '**[EMAIL]**'],
    ['~~a@b.com~~', '~~[EMAIL]~~'],
    ["'a@b.com'", "'[EMAIL]'"],
    ['|a@b.com|', '|[EMAIL]|'],
  ])('leaves the delimiters around %s outside the match', (content, expected) => {
    expect(share(content)).toBe(expected);
  });

  it.each([
    ['plain local-part characters', 'A'.repeat(200_000)],
    ['an intraword-delimiter run', 'a*'.repeat(100_000)],
    ['an escape run', 'a\\_'.repeat(66_000)],
    ["an apostrophe run", "a'".repeat(100_000)],
  ])('scans a long @-less run of %s in linear time', (_label, blob) => {
    // An unbounded local part retried at every offset made these quadratic: 40k chars took
    // ~2.6 s per call (200k: ~44 s), and the modal recomputes on every checkbox or term change.
    const started = performance.now();
    expect(texts(`${blob} then a@b.com`)).toEqual(['a@b.com']);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it.each([
    ['a@x.com.b@y.com', ['a@x.com', '.b@y.com']],
    ['a@x.com-b@y.com', ['a@x.com', '-b@y.com']],
    ['a@x.com,b@y.com', ['a@x.com', 'b@y.com']],
  ])('finds both of two touching addresses in %s', (content, expected) => {
    expect(texts(content)).toEqual(expected);
    expect(share(content)).not.toMatch(/@/);
  });

  it('scans code blocks too', () => {
    expect(texts('```\nADMIN=ops@corp.test\n```')).toEqual(['ops@corp.test']);
  });

  it('does not scan the title', () => {
    const conv = conversation({ title: 'ping a@b.com', messages: [{ role: 'user', content: 'x' }] });
    expect(findShareCandidates(conv)).toEqual([]);
  });

  it('orders candidates by message, then by offset', () => {
    const conv = conversation({
      messages: [
        { role: 'user', content: '010-1111-2222 then a@b.com' },
        { role: 'assistant', content: 'c@d.com' },
      ],
    });
    expect(findShareCandidates(conv).map((c) => [c.messageIndex, c.start])).toEqual([
      [0, 0],
      [0, 19],
      [1, 0],
    ]);
  });
});

describe('createShareCopy', () => {
  it('replaces emails and phones with their tokens', () => {
    expect(share('Mail a@b.com or call 010-1234-5678.')).toBe('Mail [EMAIL] or call [PHONE].');
  });

  it('replaces every manual term case-insensitively with [REDACTED]', () => {
    expect(share('Kim Minsu met KIM MINSU and kim minsu', { manualTerms: ['Kim Minsu'] })).toBe(
      '[REDACTED] met [REDACTED] and [REDACTED]',
    );
  });

  it('treats manual terms as literals, not patterns', () => {
    expect(share('a.b and axb and (x)', { manualTerms: ['a.b', '(x)'] })).toBe(
      '[REDACTED] and axb and [REDACTED]',
    );
  });

  it('prefers the longest manual term at a position', () => {
    expect(share('Acme Corp and Acme', { manualTerms: ['Acme', 'Acme Corp'] })).toBe(
      '[REDACTED] and [REDACTED]',
    );
  });

  it('ignores empty and whitespace-only terms', () => {
    expect(share('keep  this', { manualTerms: ['', '   '] })).toBe('keep  this');
  });

  it('leaves an excluded candidate untouched and masks the rest', () => {
    const conv = single('sample 010-0000-0000 real 010-1234-5678');
    const [sample] = findShareCandidates(conv);
    const copy = createShareCopy(conv, {
      excluded: [{ messageIndex: sample.messageIndex, start: sample.start, end: sample.end }],
      manualTerms: [],
      neutralTitle: NEUTRAL,
    });
    expect(copy.messages[0].content).toBe('sample 010-0000-0000 real [PHONE]');
  });

  it('does not let a term that spells a token match the inserted token', () => {
    expect(share('email a@b.com, phone 010-1234-5678', { manualTerms: ['email', 'phone'] })).toBe(
      '[REDACTED] [EMAIL], [REDACTED] [PHONE]',
    );
  });

  it.each([
    ['John Smith & Co', ['John Smith', 'Smith & Co'], '[REDACTED]'],
    ['Acme Corp', ['Acme Co', 'Corp'], '[REDACTED]'],
    ['banana', ['ana'], 'b[REDACTED]'],
  ])('masks every overlapping manual-term match in %s', (content, manualTerms, expected) => {
    expect(share(content, { manualTerms })).toBe(expected);
  });

  it('matches a term against the escaped Markdown the adapter emits', () => {
    // Content is adapter Markdown: run the real escaper rather than hand-writing backslashes.
    const content = escapeMarkdownText('Project [Falcon] and Acme_ and ~Acme and a|b and C:\\dir');
    expect(content).toContain('\\[Falcon\\]');
    expect(
      share(content, { manualTerms: ['[Falcon]', 'Acme_', '~Acme', 'a|b', 'C:\\dir'] }),
    ).toBe('Project [REDACTED] and [REDACTED] and [REDACTED] and [REDACTED] and [REDACTED]');
  });

  it('does not let a term match inside an inserted token', () => {
    expect(share('see a@b.com', { manualTerms: ['MAIL', 'redacted'] })).toBe('see [EMAIL]');
  });

  it('resolves a term overlapping a candidate into one token, no nesting', () => {
    expect(share('jane@acme.com', { manualTerms: ['acme'] })).toBe('[EMAIL]');
  });

  it('masks the union of overlapping spans so the later span leaks no tail', () => {
    // The term starts first and wins the token, but the email it overlaps is still fully covered.
    expect(share('Jane Doe jane@x.io ok', { manualTerms: ['Doe jane'] })).toBe(
      'Jane [REDACTED] ok',
    );
  });

  it('builds a fresh copy with a neutral title, no url, no timestamp and no message ids', () => {
    const input = conversation({
      title: 'Acme deal with a@b.com',
      createdAt: '2026-10-27T00:00:00Z',
      messages: [
        { role: 'user', content: 'hi a@b.com', id: 'm1' },
        { role: 'assistant', content: 'ok', id: 'm2' },
      ],
    });
    const before = structuredClone(input);
    const copy = createShareCopy(input, {
      excluded: [],
      manualTerms: ['hi'],
      neutralTitle: NEUTRAL,
    });

    expect(input).toEqual(before);
    expect(copy).toEqual({
      title: NEUTRAL,
      provider: 'chatgpt',
      url: '',
      messages: [
        { role: 'user', content: '[REDACTED] [EMAIL]' },
        { role: 'assistant', content: 'ok' },
      ],
    });
    expect(copy).not.toHaveProperty('createdAt');
    for (const message of copy.messages) expect(message).not.toHaveProperty('id');
    expect(copy.messages).not.toBe(input.messages);
  });

  it('leaves no synthetic value in the rendered Markdown', () => {
    const secrets = ['jane.doe@acme.test', '010-9876-5432', '+1 415 555 2671', 'Acme Widgets'];
    const input = conversation({
      title: 'Acme Widgets escalation for jane.doe@acme.test',
      url: 'https://chatgpt.com/c/secret-thread',
      createdAt: '2026-10-27T09:00:00Z',
      messages: [
        { role: 'user', content: `Contact jane.doe@acme.test or 010-9876-5432 at Acme Widgets.` },
        {
          role: 'assistant',
          content: '```env\nOWNER=jane.doe@acme.test\nUS=+1 415 555 2671\n```\nacme widgets noted.',
          id: 'msg-secret-id',
        },
      ],
    });
    const md = toMarkdown(
      createShareCopy(input, { excluded: [], manualTerms: ['Acme Widgets'], neutralTitle: NEUTRAL }),
    );

    for (const secret of [...secrets, 'secret-thread', 'msg-secret-id', '2026-10-27']) {
      expect(md.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(md).toContain(`# ${NEUTRAL}`);
    expect(md).toContain('[EMAIL]');
    expect(md).toContain('[PHONE]');
    expect(md).toContain('[REDACTED]');
  });
});
