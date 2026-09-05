export interface BackoffVector {
  failureCount: number;
  expectedMs: number;
  description: string;
}

export const DEFAULT_BACKOFF_FIXTURES: BackoffVector[] = [
  { failureCount: 0, expectedMs: 1000, description: 'zero failures defaults to base' },
  { failureCount: 1, expectedMs: 1000, description: 'first failure returns base delay' },
  { failureCount: 2, expectedMs: 2000, description: 'second failure doubles to 2s' },
  { failureCount: 3, expectedMs: 4000, description: 'third failure scales to 4s' },
  { failureCount: 4, expectedMs: 8000, description: 'fourth failure scales to 8s' },
  { failureCount: 5, expectedMs: 16000, description: 'fifth failure scales to 16s' },
  { failureCount: 6, expectedMs: 30000, description: 'sixth failure caps at max 30s' },
  { failureCount: 10, expectedMs: 30000, description: 'tenth failure remains capped at 30s' },
];

export const EDGE_CASE_FIXTURES: { input: any; expectedMs: number; description: string }[] = [
  { input: -1, expectedMs: 1000, description: 'negative count clamps to base' },
  { input: -100, expectedMs: 1000, description: 'large negative count clamps to base' },
  { input: Number.NaN, expectedMs: 1000, description: 'NaN count defaults to base' },
  { input: Infinity, expectedMs: 1000, description: 'Infinity count defaults to base' },
  { input: 2.7, expectedMs: 2000, description: 'fractional count floors to 2' },
];
