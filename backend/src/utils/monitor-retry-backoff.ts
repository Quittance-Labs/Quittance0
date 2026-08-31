/**
 * Capped exponential backoff for the payment monitor retry loop.
 *
 * Returns the number of milliseconds to wait before the next reconnect attempt,
 * starting at 1 second and doubling each failure up to a 30-second cap.
 */
export function monitorBackoffMs(failureCount: number): number {
  if (!Number.isFinite(failureCount) || failureCount < 0) {
    return 1000;
  }

  const baseMs = 1000;
  const capMs = 30000;
  const delay = baseMs * 2 ** failureCount;

  return Math.min(delay, capMs);
}
