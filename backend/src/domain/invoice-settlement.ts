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

export class IllegalStatusTransitionError extends Error {
  readonly code = 'ILLEGAL_STATUS_TRANSITION';
  readonly fromStatus: InvoiceStatus;
  readonly toStatus: InvoiceStatus;

  constructor(fromStatus: InvoiceStatus, toStatus: InvoiceStatus) {
    super(`Cannot transition invoice from ${fromStatus} to ${toStatus}`);
    this.name = 'IllegalStatusTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

export const LEGAL_STATUS_TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = Object.freeze({
  PENDING: Object.freeze(['PAID', 'EXPIRED', 'CANCELLED'] as const),
  EXPIRED: Object.freeze(['PAID'] as const),
  PAID: Object.freeze([] as const),
  CANCELLED: Object.freeze([] as const),
});

/**
 * Validates whether a transition from one status to another is legal.
 */
export function isLegalStatusTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  const allowed = LEGAL_STATUS_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Asserts that a transition from one status to another is legal, throwing IllegalStatusTransitionError if not.
 */
export function assertLegalStatusTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!isLegalStatusTransition(from, to)) {
    throw new IllegalStatusTransitionError(from, to);
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

/**
 * Computes settlement fields for settling an invoice, enforcing legal status transitions.
 */
export function settlementFieldsForInvoice(
  invoice: SettlementInvoiceState,
  settledAtInput: unknown
): SettlementFields {
  assertLegalStatusTransition(invoice.status, 'PAID');

  const settledAt = parseSettlementTime(settledAtInput);
  if (!settledAt) {
    throw new SettlementTimeUnavailableError();
  }

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

