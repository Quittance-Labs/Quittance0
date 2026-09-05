export const DEFAULT_MONITOR_BASE_BACKOFF_MS = 1_000;
export const DEFAULT_MONITOR_MAX_BACKOFF_MS = 30_000;
export const DEFAULT_MONITOR_BACKOFF_FACTOR = 2;

export interface MonitorBackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
}

/**
 * Calculates exponential backoff delay in milliseconds for payment monitor stream retries.
 * Formula: min(maxMs, baseMs * factor^max(0, failureCount - 1))
 *
 * @param failureCount Consecutive failure count.
 * @param options Custom configuration for base delay, max delay, and exponential factor.
 * @returns Delay duration in milliseconds.
 */
export function monitorBackoffMs(
  failureCount: number,
  options: MonitorBackoffOptions = {}
): number {
  const safeCount = Number.isFinite(failureCount) && failureCount > 0 ? Math.floor(failureCount) : 0;
  const base = Number.isFinite(options.baseMs) && options.baseMs! > 0 ? options.baseMs! : DEFAULT_MONITOR_BASE_BACKOFF_MS;
  const max = Number.isFinite(options.maxMs) && options.maxMs! >= base ? options.maxMs! : DEFAULT_MONITOR_MAX_BACKOFF_MS;
  const factor = Number.isFinite(options.factor) && options.factor! >= 1 ? options.factor! : DEFAULT_MONITOR_BACKOFF_FACTOR;

  if (safeCount <= 1) {
    return base;
  }

  // Calculate exponential backoff
  const rawDelay = base * Math.pow(factor, safeCount - 1);
  return Math.min(max, Math.round(rawDelay));
}

export default {
  monitorBackoffMs,
  DEFAULT_MONITOR_BASE_BACKOFF_MS,
  DEFAULT_MONITOR_MAX_BACKOFF_MS,
  DEFAULT_MONITOR_BACKOFF_FACTOR,
};
