import type { InvoiceStatus } from '../storage/invoice-storage';

export type SettlementContext = 'ON_TIME' | 'AFTER_EXPIRY' | 'AFTER_CANCEL';
export type LatePaymentWarningCode =
  | 'PAYMENT_RECEIVED_AFTER_EXPIRY'
  | 'PAYMENT_RECEIVED_AFTER_CANCEL';

export const LATE_PAYMENT_WARNINGS: Record<LatePaymentWarningCode, string> = {
  PAYMENT_RECEIVED_AFTER_EXPIRY: 'Payment was received after this invoice expired.',
  PAYMENT_RECEIVED_AFTER_CANCEL: 'Payment was received after this invoice was cancelled.',
};

export interface SettlementFields {
  settledAt: Date;
  settlementContext: SettlementContext;
  priorStatus?: InvoiceStatus;
  latePaymentWarningCode?: LatePaymentWarningCode;
}

export interface SettlementInvoiceState {
  status: InvoiceStatus;
  cancelledAt?: Date | string | null;
  expiresAt?: Date | string | null;
}

export class SettlementTimeUnavailableError extends Error {
  readonly code = 'TRANSACTION_CLOSE_TIME_UNAVAILABLE';

  constructor(message = 'Transaction close time is unavailable; try verification again later') {
    super(message);
    this.name = 'SettlementTimeUnavailableError';
  }
}

export function parseSettlementTime(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function warningForLatePayment(code: LatePaymentWarningCode): string {
  return LATE_PAYMENT_WARNINGS[code];
}

export function settlementFieldsForInvoice(
  invoice: SettlementInvoiceState,
  settledAtInput: unknown
): SettlementFields {
  const settledAt = parseSettlementTime(settledAtInput);
  if (!settledAt) {
    throw new SettlementTimeUnavailableError();
  }

  if (invoice.status === 'CANCELLED') {
    const cancelledAt = parseSettlementTime(invoice.cancelledAt);
    if (!cancelledAt) {
      throw new SettlementTimeUnavailableError(
        'Invoice cancellation time is unavailable; try verification again later'
      );
    }

    const afterCancel = settledAt.getTime() >= cancelledAt.getTime();
    return {
      settledAt,
      settlementContext: afterCancel ? 'AFTER_CANCEL' : 'ON_TIME',
      priorStatus: 'CANCELLED',
      latePaymentWarningCode: afterCancel ? 'PAYMENT_RECEIVED_AFTER_CANCEL' : undefined,
    };
  }

  // PENDING or EXPIRED: the ledger close time, not the detection time, decides
  // whether the payment landed inside the invoice's lifetime.
  const expiresAt = parseSettlementTime(invoice.expiresAt);
  const afterExpiry = expiresAt
    ? settledAt.getTime() >= expiresAt.getTime()
    : invoice.status === 'EXPIRED';

  return {
    settledAt,
    settlementContext: afterExpiry ? 'AFTER_EXPIRY' : 'ON_TIME',
    priorStatus:
      invoice.status === 'EXPIRED' || afterExpiry ? invoice.status : undefined,
    latePaymentWarningCode: afterExpiry ? 'PAYMENT_RECEIVED_AFTER_EXPIRY' : undefined,
  };
}

/** Outcomes cancel / verify / monitor may commit as the invoice's terminal status. */
export type TerminalOutcome = 'PAID' | 'CANCELLED';

/** Stable codes when a terminal commit loses the race or is otherwise illegal. */
export type TerminalConflictCode =
  | 'INVOICE_ALREADY_PAID'
  | 'INVOICE_ALREADY_CANCELLED'
  | 'INVOICE_EXPIRED'
  | 'INVOICE_NOT_PENDING';

const TERMINAL_CONFLICT_MESSAGES: Record<TerminalConflictCode, string> = {
  INVOICE_ALREADY_PAID: 'Invoice has already been paid',
  INVOICE_ALREADY_CANCELLED: 'Invoice has already been cancelled',
  INVOICE_EXPIRED: 'Invoice has expired and can no longer accept payment',
  INVOICE_NOT_PENDING: 'Invoice is not pending',
};

/**
 * Legal status transitions that decide a terminal invoice outcome.
 *
 * PAID is hard-terminal: nothing leaves it (idempotent PAID replay is not a
 * transition). CANCELLED and EXPIRED may still settle to PAID when an exact
 * on-chain payment is attributed — that is the late-settlement path from
 * LATE_PAYMENT_POLICY, not a concurrent cancel overwrite. Cancel itself is
 * PENDING → CANCELLED only.
 */
export const LEGAL_TERMINAL_TRANSITIONS: ReadonlyArray<readonly [InvoiceStatus, InvoiceStatus]> = [
  ['PENDING', 'CANCELLED'],
  ['PENDING', 'PAID'],
  ['EXPIRED', 'PAID'],
  ['CANCELLED', 'PAID'],
];

export function isLegalTerminalTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to && to === 'PAID') {
    // Idempotent replay of the same paid invoice is allowed at the claim layer;
    // it is not a storage status rewrite.
    return false;
  }
  return LEGAL_TERMINAL_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

export function messageForTerminalConflict(code: TerminalConflictCode): string {
  return TERMINAL_CONFLICT_MESSAGES[code];
}

/**
 * Raised when cancel or settlement refuses because another terminal outcome
 * already won. Carries the stable code handlers return to clients.
 */
export class InvoiceTerminalConflictError extends Error {
  readonly code: TerminalConflictCode;
  readonly currentStatus: InvoiceStatus;
  /** Present when the losing cancel must not clear an already-recorded hash. */
  readonly paymentTxHash?: string;

  constructor(code: TerminalConflictCode, currentStatus: InvoiceStatus, paymentTxHash?: string) {
    super(messageForTerminalConflict(code));
    this.name = 'InvoiceTerminalConflictError';
    this.code = code;
    this.currentStatus = currentStatus;
    this.paymentTxHash = paymentTxHash;
  }
}

/** Map a non-PENDING status onto the cancel-loser conflict code. */
export function cancelConflictForStatus(
  status: InvoiceStatus,
  paymentTxHash?: string | null
): InvoiceTerminalConflictError {
  if (status === 'PAID') {
    return new InvoiceTerminalConflictError('INVOICE_ALREADY_PAID', status, paymentTxHash ?? undefined);
  }
  if (status === 'CANCELLED') {
    return new InvoiceTerminalConflictError('INVOICE_ALREADY_CANCELLED', status, paymentTxHash ?? undefined);
  }
  if (status === 'EXPIRED') {
    return new InvoiceTerminalConflictError('INVOICE_EXPIRED', status, paymentTxHash ?? undefined);
  }
  return new InvoiceTerminalConflictError('INVOICE_NOT_PENDING', status, paymentTxHash ?? undefined);
}

/**
 * Guard used by both storages before PENDING → CANCELLED. Throws a typed
 * conflict when cancel lost the race (or the invoice was never pending).
 */
export function assertCancelTransitionAllowed(
  status: InvoiceStatus,
  paymentTxHash?: string | null
): void {
  if (status === 'PENDING') return;
  throw cancelConflictForStatus(status, paymentTxHash);
}

/**
 * Guard used by both storages before writing PAID. Replay of an already-PAID
 * invoice is handled by the caller (return existing / already-processed);
 * every other illegal source status throws.
 */
export function assertPaidTransitionAllowed(status: InvoiceStatus): void {
  if (status === 'PAID') return;
  if (isLegalTerminalTransition(status, 'PAID')) return;
  throw new InvoiceTerminalConflictError('INVOICE_NOT_PENDING', status);
}
