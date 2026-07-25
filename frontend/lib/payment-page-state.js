/**
 * Pay-page UI helpers for invoice status (issue #19).
 * Keep CANCELLED handling out of scope here — that belongs to #14.
 */

const isExpiredInvoice = (status) => status === 'EXPIRED';

const shouldShowPaymentControls = (status, paymentTxHash) => {
  if (isExpiredInvoice(status)) {
    return false;
  }

  return status === 'PENDING' && !paymentTxHash;
};

module.exports = {
  isExpiredInvoice,
  shouldShowPaymentControls,
};
