import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { getRelativeTime } from '../utils';

describe('getRelativeTime', () => {
  const now = new Date('2024-01-15T12:00:00Z');

  beforeEach(() => {
    // Mock Date.now() to return a fixed timestamp
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for null input', () => {
    expect(getRelativeTime(null)).toBeNull();
  });

  it('returns just_now for less than 1 minute ago', () => {
    const date = new Date(now.getTime() - 30 * 1000); // 30 seconds ago
    const result = getRelativeTime(date);

    expect(result).toEqual({ unit: 'just_now', value: 0 });
  });

  it('returns minutes for 1-59 minutes ago', () => {
    const date = new Date(now.getTime() - 5 * 60 * 1000); // 5 minutes ago
    const result = getRelativeTime(date);

    expect(result).toEqual({ unit: 'minutes', value: 5 });
  });

  it('returns hours for 1-23 hours ago', () => {
    const date = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3 hours ago
    const result = getRelativeTime(date);

    expect(result).toEqual({ unit: 'hours', value: 3 });
  });

  it('returns yesterday for exactly 1 day ago', () => {
    const date = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
    const result = getRelativeTime(date);

    expect(result).toEqual({ unit: 'yesterday', value: 1 });
  });

  it('returns days for 2-29 days ago', () => {
    const date = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const result = getRelativeTime(date);

    expect(result).toEqual({ unit: 'days', value: 7 });
  });

  it('returns months for 1-11 months ago', () => {
    const date = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // ~3 months ago
    const result = getRelativeTime(date);

    expect(result).toEqual({ unit: 'months', value: 3 });
  });

  it('returns years for 12+ months ago', () => {
    const date = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000); // ~13 months ago
    const result = getRelativeTime(date);

    expect(result).toEqual({ unit: 'years', value: 1 });
  });

  it('returns years for multiple years ago', () => {
    const date = new Date(now.getTime() - 800 * 24 * 60 * 60 * 1000); // ~2 years ago
    const result = getRelativeTime(date);

    expect(result).toEqual({ unit: 'years', value: 2 });
  });

  describe('boundary cases', () => {
    it('handles exactly 1 minute ago', () => {
      const date = new Date(now.getTime() - 60 * 1000); // 1 minute
      const result = getRelativeTime(date);

      expect(result).toEqual({ unit: 'minutes', value: 1 });
    });

    it('handles exactly 1 hour ago', () => {
      const date = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour
      const result = getRelativeTime(date);

      expect(result).toEqual({ unit: 'hours', value: 1 });
    });

    it('handles 30 days ago (boundary to months)', () => {
      const date = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days
      const result = getRelativeTime(date);

      expect(result).toEqual({ unit: 'months', value: 1 });
    });

    it('handles 365 days ago (boundary to years)', () => {
      const date = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); // 365 days
      const result = getRelativeTime(date);

      expect(result).toEqual({ unit: 'years', value: 1 });
    });
  });

  describe('edge cases', () => {
    it('handles dates in the future', () => {
      const date = new Date(now.getTime() + 60 * 1000); // 1 minute in future
      const result = getRelativeTime(date);

      // Negative diff results in negative minutes
      expect(result).toEqual({ unit: 'minutes', value: -1 });
    });

    it('handles very old dates', () => {
      const date = new Date(now.getTime() - 10 * 365 * 24 * 60 * 60 * 1000); // 10 years
      const result = getRelativeTime(date);

      expect(result).toEqual({ unit: 'years', value: 10 });
    });
  });
});
