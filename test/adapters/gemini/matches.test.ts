import { describe, it, expect } from 'vitest';
import { geminiAdapter } from '../../../src/adapters/gemini';
import { pickAdapter } from '../../../src/adapters';

describe('geminiAdapter.matches', () => {
  it('matches a conversation page', () => {
    // Live shape (2026-07-25): /app/<16-hex-id>.
    expect(geminiAdapter.matches('https://gemini.google.com/app/0ed512bdd038cdd9')).toBe(true);
  });

  it('matches a trailing-slashed conversation page', () => {
    expect(geminiAdapter.matches('https://gemini.google.com/app/0ed512bdd038cdd9/')).toBe(true);
  });

  it('ignores the id shape, since extraction is DOM-based once on the page', () => {
    expect(geminiAdapter.matches('https://gemini.google.com/app/not-hex-at-all')).toBe(true);
  });

  it('does not match the new-chat route, which has nothing to export', () => {
    expect(geminiAdapter.matches('https://gemini.google.com/app')).toBe(false);
    expect(geminiAdapter.matches('https://gemini.google.com/app/')).toBe(false);
  });

  it('does not match the unmeasured Gems and project routes', () => {
    // Their markup was never captured, and an adapter must not claim a page it has not been
    // verified against (AGENTS.md #5).
    expect(geminiAdapter.matches('https://gemini.google.com/gem/1a2b3c')).toBe(false);
    expect(geminiAdapter.matches('https://gemini.google.com/app/1a2b3c/extra')).toBe(false);
  });

  it('does not match a look-alike host', () => {
    // The host check is an exact set membership, not a suffix match.
    expect(geminiAdapter.matches('https://gemini.google.com.attacker.example/app/1a2b')).toBe(false);
    expect(geminiAdapter.matches('https://notgemini.google.com/app/1a2b')).toBe(false);
  });

  it('does not match other Google properties', () => {
    // The manifest host is scoped to the gemini subdomain; these must not be claimed even if
    // that grant were ever widened by mistake.
    expect(geminiAdapter.matches('https://google.com/app/1a2b')).toBe(false);
    expect(geminiAdapter.matches('https://mail.google.com/app/1a2b')).toBe(false);
  });

  it('does not match another provider’s conversation page', () => {
    expect(geminiAdapter.matches('https://chatgpt.com/c/abc')).toBe(false);
    expect(geminiAdapter.matches('https://claude.ai/chat/abc')).toBe(false);
  });

  it('returns false for a malformed URL instead of throwing', () => {
    expect(geminiAdapter.matches('not a url')).toBe(false);
    expect(geminiAdapter.matches('')).toBe(false);
  });
});

describe('adapter registry', () => {
  it('routes a Gemini conversation URL to the Gemini adapter', () => {
    // Registration is half the work: an adapter nobody can reach exports nothing.
    expect(pickAdapter('https://gemini.google.com/app/0ed512bdd038cdd9')?.provider).toBe('gemini');
  });

  it('still routes the other providers to their own adapters', () => {
    expect(pickAdapter('https://chatgpt.com/c/abc')?.provider).toBe('chatgpt');
    expect(pickAdapter('https://claude.ai/chat/abc')?.provider).toBe('claude');
  });
});
