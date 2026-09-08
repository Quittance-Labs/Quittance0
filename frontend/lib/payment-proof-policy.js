function canExportPaymentProof(invoice) {
  return invoice?.status === 'PAID';
}

function assertPaymentProofAvailable(invoice) {
  if (!canExportPaymentProof(invoice)) {
    throw new Error(
      invoice?.status === 'EXPIRED'
        ? 'Payment proof is unavailable because this invoice expired unpaid'
        : 'Payment proof is available only after the invoice is paid'
    );
  }
}

module.exports = { canExportPaymentProof, assertPaymentProofAvailable };
