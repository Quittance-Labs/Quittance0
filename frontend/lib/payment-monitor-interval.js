// Payment monitor interval helper.
//
// Picks a sensible poll interval for the payment monitor based on the invoice
// state, balancing responsiveness against backend load.

const DEFAULT_INTERVAL_MS = 5_000;

const INTERVALS_MS = Object.freeze({
  pending: 5_000,
  paid: 30_000,
  expired: 60_000,
  cancelled: 60_000,
});

/**
 * Return the recommended payment monitor interval for an invoice status.
 *
 * @param {string | undefined | null} status - Invoice status.
 * @returns {number} Interval in milliseconds.
 */
function paymentMonitorInterval(status) {
  const key = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return INTERVALS_MS[key] ?? DEFAULT_INTERVAL_MS;
}

module.exports = { paymentMonitorInterval, DEFAULT_INTERVAL_MS, INTERVALS_MS };
