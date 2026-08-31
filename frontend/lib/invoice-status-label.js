// Human-readable invoice status labels.
//
// Centralises the wording used by status badges and announcement regions so
// every page presents the same label for each invoice state.

const STATUS_LABELS = Object.freeze({
  PENDING: 'Waiting for Payment',
  PAID: 'Paid',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
});

/**
 * Return a short English label for an invoice status.
 *
 * @param {string} status - One of `'PENDING'`, `'PAID'`, `'EXPIRED'`, `'CANCELLED'`.
 * @returns {string} Human-readable label, or `'Unknown'` for unsupported values.
 */
function statusLabel(status) {
  const key = typeof status === 'string' ? status.toUpperCase() : '';
  return STATUS_LABELS[key] ?? 'Unknown';
}

module.exports = { statusLabel };
