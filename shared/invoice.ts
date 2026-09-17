/**
 * The invoice DTO as it crosses the wire, shared by the backend API and the
 * Next.js client.
 *
 * Note the deliberate difference from the backend's internal
 * `services/invoice.service.ts` Invoice: that one carries Date objects
 * because it is what storage hands around, while JSON renders a Date as an
 * ISO-8601 string. The two are not interchangeable, and conflating them is how
 * a client ends up calling .getTime() on a string. This type describes the
 * response body a caller actually receives.
 */

export type InvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

/** ISO-8601 timestamp, as produced by JSON serialisation of a Date. */
export type IsoTimestamp = string;

export type SettlementContext = 'ON_TIME' | 'AFTER_EXPIRY' | 'AFTER_CANCEL';

export type LatePaymentWarningCode =
  | 'PAYMENT_RECEIVED_AFTER_EXPIRY'
  | 'PAYMENT_RECEIVED_AFTER_CANCEL';

export interface InvoiceDto {
  id: string;
  sellerPublicKey: string;
  sellerName?: string;
  sellerEmail?: string;
  /** Decimal amount as a number in the current MVP contract. */
  amount: number;
  assetCode: string;
  assetIssuer?: string;
  memo: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  status: InvoiceStatus;
  paymentTxHash?: string;
  payerPublicKey?: string;
  payerName?: string;
  payerEmail?: string;
  createdAt: IsoTimestamp;
  paidAt?: IsoTimestamp;
  cancelledAt?: IsoTimestamp;
  settledAt?: IsoTimestamp;
  settlementContext?: SettlementContext;
  priorStatus?: InvoiceStatus;
  latePaymentWarningCode?: LatePaymentWarningCode;
  expiresAt: IsoTimestamp;
  metadata?: unknown;
  userId?: string;
  [key: string]: unknown;
}

