/**
 * Shared types for the pay page architecture.
 */

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

export interface PayPagePaymentInfo {
  stellarQrCode?: string;
  paymentUrl?: string;
  statusPollingIntervalMs?: number;
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

import type { PaymentState } from '@/lib/payment-page-state';

export interface PayPageSession {
  invoice: any;
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
  view: PayPageView;
  dispatch: (event: any) => void;
  verify: () => Promise<void>;
  reload: () => Promise<void>;
  copy: (text: string, label: string) => Promise<void>;
  copiedKey: string | null;
}
