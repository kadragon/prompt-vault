import { describe, it, expect } from 'vitest';
import { ExtractionError } from '../../src/core/errors';

describe('ExtractionError', () => {
  it('is a named Error subtype the content script can recognise', () => {
    const error = new ExtractionError('empty conversation');
    expect(error).toBeInstanceOf(ExtractionError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ExtractionError');
    expect(error.message).toBe('empty conversation');
    expect(String(error)).toBe('ExtractionError: empty conversation');
  });

  it('carries the underlying failure as `cause`', () => {
    const cause = new Error('font fetch failed');
    expect(new ExtractionError('could not load font', { cause }).cause).toBe(cause);
  });
});
