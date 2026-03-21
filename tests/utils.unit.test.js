const { maskApiKey, truncateMiddle, coercePositiveNumber } = require('../src/utils');

describe('utils helpers', () => {
  test('maskApiKey masks center while preserving shape', () => {
    const masked = maskApiKey('sk-1234567890abcdefghij');
    expect(masked.length).toBeGreaterThan(0);
    expect(masked).not.toBe('sk-1234567890abcdefghij');
    expect(masked.includes('...')).toBe(true);
  });

  test('truncateMiddle shrinks long values', () => {
    const value = truncateMiddle('abcdefghijklmnopqrstuvwxyz', 10);
    expect(value.length).toBeLessThanOrEqual(10);
  });

  test('coercePositiveNumber falls back for invalid values', () => {
    expect(coercePositiveNumber('42', 5)).toBe(42);
    expect(coercePositiveNumber('-1', 5)).toBe(5);
    expect(coercePositiveNumber('abc', 5)).toBe(5);
  });
});
