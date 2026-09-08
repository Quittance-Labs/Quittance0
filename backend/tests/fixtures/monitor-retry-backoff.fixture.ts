// Fixture data shared by the monitor retry backoff unit tests.
//
// Each fixture maps a failure count to the expected delay (in ms) so
// the tests read like a contract specification.

export interface BackoffCase {
  name: string;
  failureCount: number;
  expectedDelay: number;
}

export const BACKOFF_CASES: BackoffCase[] = [
  {
    name: 'first failure (count 0) returns base delay',
    failureCount: 0,
    expectedDelay: 1_000,
  },
  {
    name: 'second failure (count 1) doubles the delay',
    failureCount: 1,
    expectedDelay: 2_000,
  },
  {
    name: 'third failure (count 2) quadruples the base',
    failureCount: 2,
    expectedDelay: 4_000,
  },
  {
    name: 'fourth failure (count 3) reaches 8 seconds',
    failureCount: 3,
    expectedDelay: 8_000,
  },
  {
    name: 'fifth failure (count 4) reaches 16 seconds',
    failureCount: 4,
    expectedDelay: 16_000,
  },
  {
    name: 'sixth failure (count 5) hits the 30s ceiling',
    failureCount: 5,
    expectedDelay: 30_000,
  },
  {
    name: 'large failure count stays at ceiling',
    failureCount: 100,
    expectedDelay: 30_000,
  },
];

export const MALFORMED_INPUT_CASES: BackoffCase[] = [
  {
    name: 'negative failure count returns base delay',
    failureCount: -1,
    expectedDelay: 1_000,
  },
  {
    name: 'non-integer failure count returns base delay',
    failureCount: 2.5,
    expectedDelay: 1_000,
  },
  {
    name: 'NaN failure count returns base delay',
    failureCount: NaN,
    expectedDelay: 1_000,
  },
  {
    name: 'Infinity failure count returns base delay',
    failureCount: Infinity,
    expectedDelay: 1_000,
  },
];

export default { BACKOFF_CASES, MALFORMED_INPUT_CASES };
