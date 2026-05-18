import { describe, it, expect, vi, afterEach } from 'vitest';
import { Stopwatch } from '../Stopwatch';

describe('Stopwatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports zero immediately after construction', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const sw = new Stopwatch();
    now.mockReturnValue(1000);

    expect(sw.elapsedMs()).toBe(0);
  });

  it('reports rounded milliseconds since construction', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const sw = new Stopwatch();
    now.mockReturnValue(123.7);

    expect(sw.elapsedMs()).toBe(124);
  });

  it('returns an integer even when performance.now produces fractions', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(10.25);
    const sw = new Stopwatch();
    now.mockReturnValue(20.4);

    const elapsed = sw.elapsedMs();
    expect(Number.isInteger(elapsed)).toBe(true);
    expect(elapsed).toBe(10);
  });
});
