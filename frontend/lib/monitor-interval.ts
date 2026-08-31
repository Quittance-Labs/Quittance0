// Payment monitor interval helper.
// Picks a sensible poll interval for the payment monitor based on the number of
// consecutive attempts, balancing responsiveness against backend load.

const DEFAULT_INTERVAL_MS = 3_000;
const MAX_INTERVAL_MS = 30_000;

/**
 * Return the recommended payment monitor interval for a given attempt count.
 *
 * Uses capped exponential backoff: each attempt doubles the interval up to a
 * fixed maximum.
 *
 * @param attempt - Number of consecutive attempts.
 * @returns Interval in milliseconds.
 */
export function monitorIntervalMs(attempt: unknown): number {
  let n = typeof attempt === 'number' ? Math.floor(attempt) : 0;
  if (!Number.isFinite(n) || n < 0) {
    n = 0;
  }

  const interval = DEFAULT_INTERVAL_MS * 2 ** n;
  return Math.min(interval, MAX_INTERVAL_MS);
}
