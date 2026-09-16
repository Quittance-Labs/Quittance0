/** Client-side fail-closed projection of the server expiry lifecycle. */

function expiryTimestamp(expiresAt) {
  if (!expiresAt) return null;
  const timestamp = new Date(expiresAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasInvoiceExpired(invoice, now = Date.now()) {
  if (!invoice) return false;
  if (invoice.status === 'EXPIRED') return true;
  if (invoice.status !== 'PENDING') return false;

  const expiresAt = expiryTimestamp(invoice.expiresAt);
  return expiresAt !== null && expiresAt <= new Date(now).getTime();
}

function effectiveInvoiceStatus(invoice, now = Date.now()) {
  return hasInvoiceExpired(invoice, now) ? 'EXPIRED' : invoice?.status;
}

function applyExpiryStatus(invoice, now = Date.now()) {
  if (!invoice || effectiveInvoiceStatus(invoice, now) === invoice.status) return invoice;
  return { ...invoice, status: 'EXPIRED' };
}

function applyExpiryLifecycle(invoices, now = Date.now()) {
  if (!Array.isArray(invoices)) return [];
  return invoices.map((invoice) => applyExpiryStatus(invoice, now));
}

function isActionableInvoice(invoice, now = Date.now()) {
  return effectiveInvoiceStatus(invoice, now) === 'PENDING' && !invoice?.paymentTxHash;
}

const LEGAL_INVOICE_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(['PAID', 'CANCELLED', 'EXPIRED']),
  CANCELLED: Object.freeze(['PAID']),
  PAID: Object.freeze([]),
  EXPIRED: Object.freeze([]),
});

function isLegalInvoiceTransition(fromStatus, toStatus, options) {
  const allowed = LEGAL_INVOICE_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.includes(toStatus)) {
    return false;
  }
  if (fromStatus === 'CANCELLED' && toStatus === 'PAID') {
    return Boolean(options?.settledAt);
  }
  return true;
}

function isTerminalInvoiceStatus(status) {
  return status === 'PAID' || status === 'EXPIRED';
}

module.exports = {
  expiryTimestamp,
  hasInvoiceExpired,
  effectiveInvoiceStatus,
  applyExpiryStatus,
  applyExpiryLifecycle,
  isActionableInvoice,
  LEGAL_INVOICE_TRANSITIONS,
  isLegalInvoiceTransition,
  isTerminalInvoiceStatus,
};
