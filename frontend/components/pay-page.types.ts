import type { PublicInvoiceDto } from '@shared/invoice';

/**
 * Invoice shape the `/pay/[id]` page is allowed to read (issue #559).
 *
 * Mirrors `PublicInvoiceDto` with the pay-page settlement unions kept narrow.
 * There is no index signature and no seller-only fields — accessing
 * `customerEmail` (or any other workspace key) is a TypeScript error, so a
 * leaked key fails the frontend typecheck rather than silently rendering.
 */
export type PayPageInvoice = Omit<
  PublicInvoiceDto,
  'settlementContext' | 'priorStatus' | 'latePaymentWarningCode'
> & {
  settlementContext?: 'ON_TIME' | 'AFTER_EXPIRY' | 'AFTER_CANCEL';
  priorStatus?: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  latePaymentWarningCode?: 'PAYMENT_RECEIVED_AFTER_EXPIRY' | 'PAYMENT_RECEIVED_AFTER_CANCEL';
};

export interface PayPagePaymentInfo {
  stellarQrCode?: string;
  /** The full SEP-0007 URI the QR was built from — copyable payer text. */
  stellarUri?: string;
  /**
   * False when the URI outgrew the QR payload budget and the image encodes
   * the HTTPS pay link instead (issue #510).
   */
  stellarQrEncodesUri?: boolean;
  paymentUrl?: string;
  statusPollingIntervalMs?: number;
}
