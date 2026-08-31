// Dashboard history sort key helper.
//
// Builds a stable sort key for dashboard invoice history so sorting behaviour
// is consistent across re-renders and locales.

/**
 * Build a sort key for an invoice history item.
 *
 * @param {object} invoice - Invoice object.
 * @param {'createdAt' | 'amount' | 'status' | 'expiresAt'} [field='createdAt'] - Sort field.
 * @param {'asc' | 'desc'} [direction='desc'] - Sort direction.
 * @returns {number | string} Value suitable for Array.prototype.sort.
 */
function dashboardHistorySortKey(invoice, field = 'createdAt', direction = 'desc') {
  if (!invoice || typeof invoice !== 'object') {
    return direction === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }

  let value;
  switch (field) {
    case 'amount':
      value = Number(invoice.amount);
      if (!Number.isFinite(value)) value = 0;
      break;
    case 'status':
      value = String(invoice.status ?? '').toLowerCase();
      break;
    case 'expiresAt':
      value = invoice.expiresAt ? new Date(invoice.expiresAt).getTime() : 0;
      break;
    case 'createdAt':
    default:
      value = invoice.createdAt ? new Date(invoice.createdAt).getTime() : 0;
      break;
  }

  if (direction === 'asc') {
    return value;
  }

  // For descending string sorts, negate is not valid; caller should reverse.
  if (typeof value === 'string') {
    return value;
  }

  return -value;
}

module.exports = { dashboardHistorySortKey };
