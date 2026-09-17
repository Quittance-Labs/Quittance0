import type { PayPageInvoice, PaymentSessionStatus } from '@/components/pay-page.types';

export interface PaymentSessionState {
  status: PaymentSessionStatus;
  invoice: PayPageInvoice | null;
  txHash: string | null;
  error: string | null;
  isOutage?: boolean;
}

export type PaymentSessionEvent =
  | { type: 'LOAD_STARTED' }
  | { type: 'INVOICE_LOADED'; invoice: PayPageInvoice | null }
  | { type: 'LOAD_FAILED'; error?: string; isOutage?: boolean }
  | { type: 'POLL_RESULT'; invoice: PayPageInvoice | null }
  | { type: 'PAY_STARTED' }
  | { type: 'PAY_SENT'; txHash?: string }
  | { type: 'PAY_FAILED'; error?: string }
  | { type: 'VERIFY_STARTED'; txHash?: string }
  | { type: 'VERIFY_SUCCEEDED'; invoice?: PayPageInvoice | null; txHash?: string }
  | { type: 'VERIFY_FAILED'; error?: string }
  | { type: 'VERIFY_UNAVAILABLE' }
  | { type: 'RESET' };

export declare const SESSION_STATES: {
  readonly LOADING: 'loading';
  readonly READY: 'ready';
  readonly PAYING: 'paying';
  readonly VERIFYING: 'verifying';
  readonly PAID: 'paid';
  readonly REJECTED: 'rejected';
  readonly UNAVAILABLE: 'unavailable';
};

export declare const TERMINAL_SESSION_STATUSES: readonly PaymentSessionStatus[];

export function isTerminalSessionStatus(status?: string | null): boolean;

export function deriveSessionStatus(params: {
  loading?: boolean;
  invoice?: PayPageInvoice | null;
  paymentStatus?: string | null;
  loadError?: string | null;
}): PaymentSessionStatus;

export function initialSessionState(
  invoice?: PayPageInvoice | null,
  options?: { loading?: boolean }
): PaymentSessionState;

export function sessionReducer(
  state: PaymentSessionState,
  event: PaymentSessionEvent
): PaymentSessionState;

export function isSessionBusy(statusOrState?: PaymentSessionState | string | null): boolean;

export function isSessionResult(statusOrState?: PaymentSessionState | string | null): boolean;

export function shouldSessionPoll(state?: PaymentSessionState | null): boolean;

export function describeSessionState(state?: PaymentSessionState | null): string;
