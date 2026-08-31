/**
 * Human-readable English labels for invoice payment statuses.
 */

const LABELS = {
  PENDING: 'Pending',
  PAID: 'Paid',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

function statusLabel(status) {
  if (status in LABELS) {
    return LABELS[status];
  }
  return 'Unknown';
}

module.exports = { statusLabel };
