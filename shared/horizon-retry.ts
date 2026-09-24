/**
 * Shared Horizon outage retry ceiling (issue #556).
 *
 * The payment monitor backs off up to this many milliseconds after a Horizon
 * timeout, 429, or transport failure. The pay page tells the payer to wait
 * for the same window so both sides share one policy.
 */
export const HORIZON_OUTAGE_BACKOFF_MAX_MS = 30_000;

/** Whole seconds for payer-facing copy; derived from the ms ceiling. */
export const HORIZON_OUTAGE_RETRY_WAIT_SECONDS = HORIZON_OUTAGE_BACKOFF_MAX_MS / 1000;
