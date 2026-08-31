// Pay page terminal state guard helper.
//
// Determines whether the pay page is in a terminal (non-actionable) state so
// the UI can disable payment controls and show the correct result panel.

const TERMINAL_STATUSES = Object.freeze(new Set(['PAID', 'EXPIRED', 'CANCELLED']));

/**
 * Check whether an invoice status is terminal.
 *
 * @param {string | undefined | null} status - Invoice status.
 * @returns {boolean} True when the status is paid, expired, or cancelled.
 */
function isTerminalPayStatus(status) {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status.toUpperCase());
}

module.exports = { isTerminalPayStatus, TERMINAL_STATUSES };
