/**
 * Fixture data for monitor retry backoff tests.
 */

import { BackoffOptions } from '../../src/utils/monitor-retry-backoff';

export interface BackoffTestCase {
  name: string;
  failureCount: number;
  options?: BackoffOptions;
  expectedDelayMs: number;
}

export interface InvalidInputCase {
  name: string;
  failureCount: unknown;
  options?: BackoffOptions;
  expectedDelayMs: number;
}

export interface ValidationCase {
  name: string;
  input: unknown;
  expectedValid: boolean;
}

export const STANDARD_BACKOFF_CASES: BackoffTestCase[] = [
  {
    name: '0 failures returns base initial delay of 1000ms',
    failureCount: 0,
    expectedDelayMs: 1000,
  },
  {
    name: '1 failure returns 2000ms (1000 * 2^1)',
    failureCount: 1,
    expectedDelayMs: 2000,
  },
  {
    name: '2 failures returns 4000ms (1000 * 2^2)',
    failureCount: 2,
    expectedDelayMs: 4000,
  },
  {
    name: '3 failures returns 8000ms (1000 * 2^3)',
    failureCount: 3,
    expectedDelayMs: 8000,
  },
  {
    name: '4 failures returns 16000ms (1000 * 2^4)',
    failureCount: 4,
    expectedDelayMs: 16000,
  },
  {
    name: '5 failures caps at 30000ms (32000 > 30000 cap)',
    failureCount: 5,
    expectedDelayMs: 30000,
  },
  {
    name: '6 failures remains capped at 30000ms',
    failureCount: 6,
    expectedDelayMs: 30000,
  },
  {
    name: '10 failures remains capped at 30000ms',
    failureCount: 10,
    expectedDelayMs: 30000,
  },
  {
    name: '50 failures safely caps at 30000ms without numerical overflow',
    failureCount: 50,
    expectedDelayMs: 30000,
  },
  {
    name: '1000 failures safely caps at 30000ms without exponent overflow',
    failureCount: 1000,
    expectedDelayMs: 30000,
  },
];

export const CUSTOM_OPTIONS_CASES: BackoffTestCase[] = [
  {
    name: 'custom initial delay of 500ms at 0 failures',
    failureCount: 0,
    options: { initialDelayMs: 500 },
    expectedDelayMs: 500,
  },
  {
    name: 'custom initial delay of 500ms at 1 failure',
    failureCount: 1,
    options: { initialDelayMs: 500 },
    expectedDelayMs: 1000,
  },
  {
    name: 'custom max delay cap of 10000ms',
    failureCount: 4,
    options: { maxDelayMs: 10000 },
    expectedDelayMs: 10000,
  },
  {
    name: 'custom backoff factor of 3',
    failureCount: 2,
    options: { factor: 3, maxDelayMs: 50000 },
    expectedDelayMs: 9000, // 1000 * 3^2
  },
  {
    name: 'custom initial, max, and factor options combined',
    failureCount: 3,
    options: { initialDelayMs: 250, factor: 4, maxDelayMs: 20000 },
    expectedDelayMs: 16000, // 250 * 4^3 = 16000
  },
];

export const INVALID_INPUT_CASES: InvalidInputCase[] = [
  {
    name: 'negative failure count falls back to initial delay',
    failureCount: -1,
    expectedDelayMs: 1000,
  },
  {
    name: 'large negative failure count falls back to initial delay',
    failureCount: -100,
    expectedDelayMs: 1000,
  },
  {
    name: 'NaN failure count falls back to initial delay',
    failureCount: NaN,
    expectedDelayMs: 1000,
  },
  {
    name: 'Infinity failure count falls back to initial delay',
    failureCount: Infinity,
    expectedDelayMs: 1000,
  },
  {
    name: '-Infinity failure count falls back to initial delay',
    failureCount: -Infinity,
    expectedDelayMs: 1000,
  },
  {
    name: 'null failure count falls back to initial delay',
    failureCount: null,
    expectedDelayMs: 1000,
  },
  {
    name: 'undefined failure count falls back to initial delay',
    failureCount: undefined,
    expectedDelayMs: 1000,
  },
  {
    name: 'string failure count falls back to initial delay',
    failureCount: '3',
    expectedDelayMs: 1000,
  },
  {
    name: 'boolean failure count falls back to initial delay',
    failureCount: true,
    expectedDelayMs: 1000,
  },
  {
    name: 'object failure count falls back to initial delay',
    failureCount: { failures: 5 },
    expectedDelayMs: 1000,
  },
];

export const VALIDATION_CASES: ValidationCase[] = [
  { name: '0 is a valid failure count', input: 0, expectedValid: true },
  { name: '1 is a valid failure count', input: 1, expectedValid: true },
  { name: '10 is a valid failure count', input: 10, expectedValid: true },
  { name: '2.5 is a valid finite non-negative number', input: 2.5, expectedValid: true },
  { name: '-1 is rejected as negative', input: -1, expectedValid: false },
  { name: 'NaN is rejected', input: NaN, expectedValid: false },
  { name: 'Infinity is rejected', input: Infinity, expectedValid: false },
  { name: '-Infinity is rejected', input: -Infinity, expectedValid: false },
  { name: 'null is rejected', input: null, expectedValid: false },
  { name: 'undefined is rejected', input: undefined, expectedValid: false },
  { name: 'string is rejected', input: '5', expectedValid: false },
  { name: 'boolean is rejected', input: true, expectedValid: false },
  { name: 'object is rejected', input: {}, expectedValid: false },
];

export default {
  STANDARD_BACKOFF_CASES,
  CUSTOM_OPTIONS_CASES,
  INVALID_INPUT_CASES,
  VALIDATION_CASES,
};
