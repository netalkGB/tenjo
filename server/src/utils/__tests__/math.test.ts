import { describe, it, expect } from 'vitest';
import { add } from '../math';

describe('Math utilities', () => {
  it('should add two numbers', () => {
    expect(add(2, 3)).toBe(5);
  });
});
