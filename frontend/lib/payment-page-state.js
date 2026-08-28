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

const shouldStopPolling = (status, pollingErrorCount = 0) => {
  if (status !== 'PENDING') return true;
  if (pollingErrorCount >= 5) return true;
  return false;
};

const getVerificationErrorMessage = (error) => {
  if (error?.response?.status === 404) return 'Invoice not found';
  if (error?.response?.data?.error) return error.response.data.error;
  return 'Failed to verify transaction';
};

module.exports.shouldStopPolling = shouldStopPolling;
module.exports.getVerificationErrorMessage = getVerificationErrorMessage;
