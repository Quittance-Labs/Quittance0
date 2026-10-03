/**
 * Shared types for the pay page modular architecture (issue #445).
 */

import type { PaymentState } from '@/lib/payment-page-state';

export interface PayPageInvoice {
  [key: string]: unknown;
  id: string;
  amount: number;
  assetCode: string;
  assetIssuer?: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  sellerPublicKey: string;
  sellerName?: string;
  sellerEmail?: string;
  memo: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
  expiresAt: string;
  paidAt?: string;
  cancelledAt?: string;
  settledAt?: string;
  settlementContext?: 'ON_TIME' | 'AFTER_EXPIRY' | 'AFTER_CANCEL';
  priorStatus?: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  latePaymentWarningCode?: 'PAYMENT_RECEIVED_AFTER_EXPIRY' | 'PAYMENT_RECEIVED_AFTER_CANCEL';
  paymentTxHash?: string;
  payerName?: string;
  payerEmail?: string;
  payerPublicKey?: string;
}

/**
 * Server pay-link artifact (issue #557). Create, the pay page, and the seller
 * invoice page all render these same strings — they never rebuild the URI.
 */
export interface PayPagePaymentInfo {
  stellarQrCode?: string | null;
  /** The full SEP-0007 URI — always returned even when the QR falls back. */
  stellarUri?: string | null;
  /**
   * False when the URI outgrew the QR payload budget and the image encodes
   * the HTTPS pay link instead (issue #510).
   */
  stellarQrEncodesUri?: boolean | null;
  paymentUrl?: string | null;
  /**
   * Whatever the QR encoded — the SEP-0007 URI or the HTTPS pay link. Copy
   * actions on create, the pay page, and the seller page use this string.
   */
  copyValue?: string | null;
  /** Passphrase from the same resolver explorer links use. */
  networkPassphrase?: string | null;
  statusPollingIntervalMs?: number;
  paymentAvailable?: boolean;
}

export type PaymentSessionStatus =
  | 'loading'
  | 'ready'
  | 'paying'
  | 'verifying'
  | 'paid'
  | 'rejected'
  | 'unavailable';

export interface PayPageView {
  expired: boolean;
  cancelled: boolean;
  paid: boolean;
  showPaymentControls: boolean;
  showProof: boolean;
  showMonitor: boolean;
}

export interface PaymentSessionState {
  status: PaymentSessionStatus;
  invoice: PayPageInvoice | null;
  paymentInfo?: PayPagePaymentInfo | null;
  txHash: string | null;
  error: string | null;
  isOutage?: boolean;
}

export interface PayPageSession {
  invoice: PayPageInvoice | null;
  payment: PaymentState;
  status: PaymentSessionStatus;
  loading: boolean;
  loadError: string | null;
  paymentInfo: PayPagePaymentInfo | null;
  wallet: string | null;
  txHash: string;
  setTxHash: (value: string) => void;
  payerName: string;
  setPayerName: (value: string) => void;
  payerEmail: string;
  setPayerEmail: (value: string) => void;
  verifying: boolean;
  monitoring: boolean;
  resumeAvailable: boolean;
  view: PayPageView;
  dispatch: (event: unknown) => void;
  verify: (hashOverride?: string) => Promise<void>;
  reload: () => Promise<void>;
  copy: (text: string, label: string) => Promise<void>;
}
