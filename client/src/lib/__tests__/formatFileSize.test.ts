import { describe, it, expect } from 'vitest';
import { formatFileSize } from '../formatFileSize';

describe('formatFileSize', () => {
  it('returns bytes for values under 1 KB', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('returns KB for values under 1 MB', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024.0 KB');
  });

  it('returns MB for values under 1 GB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatFileSize(500 * 1024 * 1024)).toBe('500.0 MB');
  });

  it('returns GB for values 1 GB and above', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });
});
