/**
 * Payment monitor retry backoff helper.
 *
 * Provides capped exponential backoff delay calculation for reconnecting
 * the Stellar payment stream monitor upon network disconnection or streaming errors.
 */

export const DEFAULT_INITIAL_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;
export const DEFAULT_BACKOFF_FACTOR = 2;

export interface BackoffOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
}

/**
 * Validates if the failure count is a valid finite non-negative number.
 *
 * @param failureCount Value to validate
 * @returns true if valid finite non-negative number, false otherwise
 */
export function isValidFailureCount(failureCount: unknown): failureCount is number {
  return (
    typeof failureCount === 'number' &&
    Number.isFinite(failureCount) &&
    !Number.isNaN(failureCount) &&
    failureCount >= 0
  );
}

/**
 * Calculate the backoff delay in milliseconds based on the number of consecutive failures.
 *
 * Capped exponential backoff algorithm:
 *   delay = min(maxDelayMs, initialDelayMs * (factor ^ failureCount))
 *
 * For invalid, negative, non-numeric, or non-finite inputs, safely falls back
 * to the initial delay (1000ms by default).
 *
 * @param failureCount Number of consecutive failures (non-negative integer/number)
 * @param options Optional configuration overrides (initialDelayMs, maxDelayMs, factor)
 * @returns Delay in milliseconds (clamped between initialDelayMs and maxDelayMs)
 */
export function monitorBackoffMs(
  failureCount: number,
  options?: BackoffOptions
): number {
  const initialDelay =
    options?.initialDelayMs !== undefined &&
    Number.isFinite(options.initialDelayMs) &&
    options.initialDelayMs > 0
      ? options.initialDelayMs
      : DEFAULT_INITIAL_DELAY_MS;

  const maxDelay =
    options?.maxDelayMs !== undefined &&
    Number.isFinite(options.maxDelayMs) &&
    options.maxDelayMs >= initialDelay
      ? options.maxDelayMs
      : DEFAULT_MAX_DELAY_MS;

  const factor =
    options?.factor !== undefined &&
    Number.isFinite(options.factor) &&
    options.factor >= 1
      ? options.factor
      : DEFAULT_BACKOFF_FACTOR;

  if (!isValidFailureCount(failureCount)) {
    return initialDelay;
  }

  // Guard against very large exponents causing overflow or unnecessary computations
  if (failureCount >= 30) {
    return maxDelay;
  }

  const computedDelay = initialDelay * Math.pow(factor, failureCount);

  if (!Number.isFinite(computedDelay) || computedDelay > maxDelay) {
    return maxDelay;
  }

  return Math.max(initialDelay, Math.round(computedDelay));
}

export default {
  monitorBackoffMs,
  isValidFailureCount,
  DEFAULT_INITIAL_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_BACKOFF_FACTOR,
};
