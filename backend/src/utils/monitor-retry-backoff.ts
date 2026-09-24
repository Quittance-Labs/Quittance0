// Monitor retry backoff helper.
//
// The payment monitor retries failed stream connections. Without a cap,
// exponential backoff can produce delays of hours after only a handful of
// failures — far longer than a transient network blip warrants. This module
// provides a single pure function that computes the delay (in milliseconds)
// for the Nth consecutive failure using a base delay, an exponential factor,
// and an absolute ceiling.
//
// The ceiling is shared with the pay page (issue #556): a Horizon outage asks
// the payer to wait for the same window the monitor uses between retries.

import { HORIZON_OUTAGE_BACKOFF_MAX_MS } from '../../../shared/horizon-retry';

/**
 * Base delay applied for the first failure, in milliseconds.
 */
export const BACKOFF_BASE_MS = 1_000; // 1 second

/**
 * Multiplier applied per failure count. A value of 2 yields classic
 * exponential backoff: 1s, 2s, 4s, 8s, …
 */
export const BACKOFF_FACTOR = 2;

/**
 * Absolute ceiling on the computed delay, in milliseconds.
 * Shared with shared/horizon-retry.ts so pay-page copy matches monitor policy.
 */
export const BACKOFF_MAX_MS = HORIZON_OUTAGE_BACKOFF_MAX_MS;

/**
 * Compute the backoff delay (in milliseconds) for the Nth consecutive
 * failure of the payment monitor.
 *
 * The formula is:
 *
 *   delay = min(BASE * FACTOR ^ failureCount, MAX)
 *
 * - `failureCount` of 0 or negative returns the base delay (treated as
 *   first attempt).
 * - Non-integer failure counts are rejected and the base delay is returned.
 * - The result is always an integer number of milliseconds.
 *
 * @param failureCount  Number of consecutive failures observed so far.
 *                      Must be a non-negative integer. Values < 0 or
 *                      non-integer are clamped/rejected to the base.
 * @returns Delay in milliseconds before the next retry.
 */
export const monitorBackoffMs = (failureCount: number): number => {
  if (!Number.isInteger(failureCount) || failureCount < 0) {
    return BACKOFF_BASE_MS;
  }

  const raw = BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, failureCount);
  const clamped = Math.min(raw, BACKOFF_MAX_MS);
  return Math.round(clamped);
};

export default {
  monitorBackoffMs,
  BACKOFF_BASE_MS,
  BACKOFF_FACTOR,
  BACKOFF_MAX_MS,
};
