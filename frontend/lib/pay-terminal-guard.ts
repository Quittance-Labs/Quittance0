// Pay page terminal state guard helper.
// Determines whether the pay page is in a terminal (non-actionable) state so
// the UI can disable payment controls and show the correct result panel.

const TERMINAL_STATUSES = Object.freeze(new Set(['PAID', 'EXPIRED', 'CANCELLED']));

/**
 * Check whether an invoice status is terminal.
 *
 * @param status - Invoice status.
 * @returns True when the status is paid, expired, or cancelled.
 */
export function isTerminalPayState(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status.trim().toUpperCase());
}
