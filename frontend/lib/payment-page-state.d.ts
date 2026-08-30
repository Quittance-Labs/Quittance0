export type PayStatus = 'idle' | 'paying' | 'verifying' | 'paid' | 'error' | 'expired';

export interface PayInvoice {
  status: string;
  expiresAt?: string | Date;
  paymentTxHash?: string | null;
  [key: string]: unknown;
}

export interface PaymentState {
  status: PayStatus;
  invoice: PayInvoice | null;
  txHash: string | null;
  error: string | null;
}

export type PaymentEvent =
  | { type: 'INVOICE_LOADED'; invoice: PayInvoice | null }
  | { type: 'POLL_RESULT'; invoice: PayInvoice | null }
  | { type: 'PAY_STARTED' }
  | { type: 'PAY_SENT'; txHash?: string }
  | { type: 'PAY_FAILED'; error?: string }
  | { type: 'VERIFY_STARTED' }
  | { type: 'VERIFY_SUCCEEDED'; invoice?: PayInvoice | null; txHash?: string }
  | { type: 'VERIFY_FAILED'; error?: string }
  | { type: 'RESET' };

export interface PayerDetails {
  payerName?: string;
  payerEmail?: string;
}

export type PayerDetailsResult =
  | { ok: true; value: PayerDetails }
  | { ok: false; error: string };

export declare const PAY_STATES: {
  readonly IDLE: 'idle';
  readonly PAYING: 'paying';
  readonly VERIFYING: 'verifying';
  readonly PAID: 'paid';
  readonly ERROR: 'error';
  readonly EXPIRED: 'expired';
};

export declare const TERMINAL_STATES: readonly PayStatus[];

export function isExpiredInvoice(statusOrInvoice: string | PayInvoice, now?: string | number | Date): boolean;

export function shouldShowPaymentControls(
  statusOrInvoice: string | PayInvoice,
  paymentTxHash?: string | null,
  now?: string | number | Date
): boolean;

export function getPayPageView(invoice?: PayInvoice | null): {
  expired: boolean;
  paid: boolean;
  showPaymentControls: boolean;
  showProof: boolean;
  showMonitor: boolean;
};

export function stateForStatus(statusOrInvoice: string | PayInvoice, now?: string | number | Date): PayStatus | null;
export function initialPaymentState(invoice?: PayInvoice | null): PaymentState;
export function paymentReducer(state: PaymentState, event: PaymentEvent): PaymentState;
export function shouldPoll(state: PaymentState): boolean;
export function normalizePayerDetails(details?: PayerDetails): PayerDetailsResult;
export function describeVerifyError(error: unknown, fallback?: string): string;
export function isLikelyTransactionHash(value?: string | null): boolean;
