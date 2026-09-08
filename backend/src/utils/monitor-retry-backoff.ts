// Monitor retry backoff helper.
//
// The payment monitor retries failed stream connections. Without a cap,
// exponential backoff can produce delays of hours after only a handful of
// failures — far longer than a transient network blip warrants. This module
// provides a single pure function that computes the delay (in milliseconds)
// for the Nth consecutive failure using a base delay, an exponential factor,
// and an absolute ceiling.

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
 * No matter how many failures accumulate, the delay never exceeds 30 seconds.
 */
export const BACKOFF_MAX_MS = 30_000; // 30 seconds

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
  // Reject non-integer or negative inputs — treat them as first attempt.
  if (!Number.isInteger(failureCount) || failureCount < 0) {
    return BACKOFF_BASE_MS;
  }

  // Compute base * factor^failureCount, guarding against overflow.
  // Math.pow(2, n) is safe for n up to 1023; our cap kicks in long before.
  const raw = BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, failureCount);

  // Clamp to the ceiling. Use Math.min which naturally handles Infinity.
  const clamped = Math.min(raw, BACKOFF_MAX_MS);

  // Round to integer milliseconds to avoid fractional delays.
  return Math.round(clamped);
};

export default {
  monitorBackoffMs,
  BACKOFF_BASE_MS,
  BACKOFF_FACTOR,
  BACKOFF_MAX_MS,
};
