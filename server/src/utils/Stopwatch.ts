/**
 * Tiny monotonic stopwatch for measuring elapsed wall-clock time.
 *
 * Uses `performance.now()` (monotonic high-resolution) instead of `Date.now()`
 * so it isn't affected by NTP adjustments or manual system clock changes
 * during the measured operation.
 */
export class Stopwatch {
  private readonly startedAt: number;

  constructor() {
    this.startedAt = performance.now();
  }

  /** Milliseconds elapsed since construction, rounded to an integer. */
  elapsedMs(): number {
    return Math.round(performance.now() - this.startedAt);
  }
}
