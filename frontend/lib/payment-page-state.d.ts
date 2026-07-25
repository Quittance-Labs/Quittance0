export function isExpiredInvoice(status: string): boolean;

export function shouldShowPaymentControls(
  status: string,
  paymentTxHash?: string | null
): boolean;
