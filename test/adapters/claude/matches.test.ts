import { describe, it, expect } from 'vitest';
import { matches, matchesProject } from '../../../src/adapters/claude/matches';

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
    // Project homes are handled by the separate project gate, not the conversation gate.
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

describe('claude matchesProject', () => {
  it('accepts both measured Claude Project home route families', () => {
    expect(matchesProject('https://claude.ai/cowork/project/abc-123')).toBe(true);
    expect(matchesProject('https://claude.ai/project/abc-123')).toBe(true);
    expect(matchesProject('https://claude.ai/project/abc-123/')).toBe(true);
  });

  it('rejects conversation routes and unmeasured project paths', () => {
    expect(matchesProject('https://claude.ai/chat/abc-123')).toBe(false);
    expect(matchesProject('https://claude.ai/cowork/projects/abc-123')).toBe(false);
    expect(matchesProject('https://claude.ai/projects/abc-123')).toBe(false);
  });

  it('rejects other hosts and malformed input', () => {
    expect(matchesProject('https://example.com/project/abc-123')).toBe(false);
    expect(matchesProject('https://claude.ai.attacker.example/project/abc-123')).toBe(false);
    expect(matchesProject('not a url')).toBe(false);
  });
});
