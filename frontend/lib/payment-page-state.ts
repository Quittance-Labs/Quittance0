export function isExpiredInvoice(status: string): boolean {
  return status === 'EXPIRED';
}

export function shouldShowPaymentControls(
  status: string,
  paymentTxHash?: string | null
): boolean {
  if (isExpiredInvoice(status)) {
    return false;
  }

  return status === 'PENDING' && !paymentTxHash;
}
