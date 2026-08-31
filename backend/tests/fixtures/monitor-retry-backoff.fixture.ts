/**
 * Fixture data for monitor retry backoff tests.
 */

export const BACKOFF_CASES = [
  { failureCount: 0, expected: 1000 },
  { failureCount: 1, expected: 2000 },
  { failureCount: 2, expected: 4000 },
  { failureCount: 3, expected: 8000 },
  { failureCount: 4, expected: 16000 },
  { failureCount: 5, expected: 30000 },
  { failureCount: 10, expected: 30000 },
];

export const INVALID_COUNTS = [
  { failureCount: -1, expected: 1000 },
  { failureCount: Number.NaN, expected: 1000 },
  { failureCount: Number.POSITIVE_INFINITY, expected: 1000 },
];
