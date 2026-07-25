import { describe, it, expect } from 'vitest';
import { matches } from '../../../src/adapters/claude/matches';

describe('claude matches', () => {
  it('accepts a conversation page, with or without a trailing slash', () => {
    expect(matches('https://claude.ai/chat/0b3f2c1a-7d44-4e91-9a02-5c8e1f6b3d7e')).toBe(true);
    expect(matches('https://claude.ai/chat/0b3f2c1a-7d44-4e91-9a02-5c8e1f6b3d7e/')).toBe(true);
  });

  it('accepts a conversation URL carrying a query or fragment', () => {
    // Only the pathname is gated; the SPA appends query/hash state freely.
    expect(matches('https://claude.ai/chat/abc-123?foo=1')).toBe(true);
    expect(matches('https://claude.ai/chat/abc-123#section')).toBe(true);
  });

  it('rejects non-conversation routes on the supported host', () => {
    expect(matches('https://claude.ai/')).toBe(false);
    expect(matches('https://claude.ai/chat/')).toBe(false);
    expect(matches('https://claude.ai/chat')).toBe(false);
    expect(matches('https://claude.ai/new')).toBe(false);
    expect(matches('https://claude.ai/recents')).toBe(false);
    // Projects are out of scope for v1 — the project track is unimplemented.
    expect(matches('https://claude.ai/project/abc-123')).toBe(false);
    // Deeper paths are not conversation pages.
    expect(matches('https://claude.ai/chat/abc/extra')).toBe(false);
  });

  it('rejects other hosts, including look-alike domains', () => {
    expect(matches('https://example.com/chat/abc')).toBe(false);
    expect(matches('https://claude.ai.attacker.example/chat/abc')).toBe(false);
    expect(matches('https://notclaude.ai/chat/abc')).toBe(false);
    // ChatGPT pages belong to the ChatGPT adapter, not this one.
    expect(matches('https://chatgpt.com/c/abc-123')).toBe(false);
  });

  it('returns false for unparseable input instead of throwing', () => {
    expect(matches('not a url')).toBe(false);
    expect(matches('')).toBe(false);
  });
});
