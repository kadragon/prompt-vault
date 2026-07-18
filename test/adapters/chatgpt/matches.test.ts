import { describe, it, expect } from 'vitest';
import { matches, matchesProject } from '../../../src/adapters/chatgpt/matches';

describe('chatgpt matches', () => {
  it('accepts a ChatGPT conversation URL', () => {
    expect(matches('https://chatgpt.com/c/abc-123')).toBe(true);
    expect(matches('https://chatgpt.com/c/abc-123/')).toBe(true);
    expect(matches('https://chat.openai.com/c/xyz')).toBe(true);
  });

  it('rejects non-conversation paths on a supported host', () => {
    expect(matches('https://chatgpt.com/')).toBe(false);
    expect(matches('https://chatgpt.com/c/')).toBe(false);
    expect(matches('https://chatgpt.com/gpts')).toBe(false);
    expect(matches('https://chatgpt.com/c/abc/extra')).toBe(false);
  });

  it('rejects unsupported and look-alike hosts', () => {
    expect(matches('https://example.com/c/abc')).toBe(false);
    expect(matches('https://chatgpt.com.attacker.example/c/abc')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(matches('not a url')).toBe(false);
  });
});

describe('chatgpt matchesProject', () => {
  it('accepts a Project home page URL', () => {
    expect(matchesProject('https://chatgpt.com/g/g-p-abc123/project')).toBe(true);
    expect(matchesProject('https://chatgpt.com/g/g-p-abc123-my-slug/project')).toBe(true);
    expect(matchesProject('https://chatgpt.com/g/g-p-abc123/project/')).toBe(true);
    expect(matchesProject('https://chat.openai.com/g/g-p-xyz/project')).toBe(true);
  });

  it('rejects project conversation pages and plain conversations (not project home pages)', () => {
    expect(matchesProject('https://chatgpt.com/g/g-p-abc123/c/conv-1')).toBe(false);
    expect(matchesProject('https://chatgpt.com/g/g-p-abc123-slug/c/conv-1')).toBe(false);
    expect(matchesProject('https://chatgpt.com/c/abc-123')).toBe(false);
  });

  it('rejects non-project /g/ pages and other paths', () => {
    expect(matchesProject('https://chatgpt.com/g/g-abc/project')).toBe(false); // a GPT, not a project (no g-p-)
    expect(matchesProject('https://chatgpt.com/projects')).toBe(false);
    expect(matchesProject('https://chatgpt.com/')).toBe(false);
  });

  it('rejects unsupported/look-alike hosts and malformed URLs', () => {
    expect(matchesProject('https://chatgpt.com.attacker.example/g/g-p-abc/project')).toBe(false);
    expect(matchesProject('not a url')).toBe(false);
  });

  // The single-conversation toolbar gate stays /c/<id>-only: a project home page must
  // NOT read as a conversation page (that would mount the per-conversation buttons).
  it('is disjoint from the conversation gate', () => {
    const projectHome = 'https://chatgpt.com/g/g-p-abc123/project';
    expect(matchesProject(projectHome)).toBe(true);
    expect(matches(projectHome)).toBe(false);
  });
});
