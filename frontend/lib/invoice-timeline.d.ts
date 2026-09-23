export type InvoiceTimelineEventType =
  | 'created'
  | 'awaiting-payment'
  | 'expired'
  | 'cancelled'
  | 'paid';

export interface InvoiceTimelineEvent {
  type: InvoiceTimelineEventType;
  label: string;
  timestamp: string | null;
  deadline?: string;
  payerPublicKey?: string;
  paymentTxHash?: string;
  lateWarningCode?: 'PAYMENT_RECEIVED_AFTER_EXPIRY' | 'PAYMENT_RECEIVED_AFTER_CANCEL' | null;
}

export interface InvoiceTimelineInput {
  status?: string;
  createdAt?: string;
  expiresAt?: string;
  paidAt?: string;
  settledAt?: string;
  cancelledAt?: string;
  payerPublicKey?: string;
  paymentTxHash?: string;
  settlementContext?: 'ON_TIME' | 'AFTER_EXPIRY' | 'AFTER_CANCEL' | null;
  priorStatus?: string | null;
  latePaymentWarningCode?: 'PAYMENT_RECEIVED_AFTER_EXPIRY' | 'PAYMENT_RECEIVED_AFTER_CANCEL' | null;
}

export function buildInvoiceTimelineEvents(
  invoice?: InvoiceTimelineInput | null,
  now?: number
): InvoiceTimelineEvent[];
