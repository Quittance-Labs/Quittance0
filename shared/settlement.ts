/**
 * Canonical invoice settlement classification (issue #507).
 *
 * Settlement context is decided only from Horizon ledger close time versus
 * stored expiresAt / cancelledAt. Server wall clock never enters the decision.
 * Verify, monitor, receipt, timeline, and PDF all consume this module so they
 * cannot drift apart on codes or copy.
 *
 * Written policy remains docs/LATE_PAYMENT_POLICY.md and
 * docs/EXPIRY-AND-LATE-PAYMENT.md. This file is the executable form of that
 * matrix, not a second prose policy.
 */

import type { InvoiceStatus } from './invoice';

export type SettlementContext = 'ON_TIME' | 'AFTER_EXPIRY' | 'AFTER_CANCEL';

export type LatePaymentWarningCode =
  | 'PAYMENT_RECEIVED_AFTER_EXPIRY'
  | 'PAYMENT_RECEIVED_AFTER_CANCEL';

export interface LatePaymentWarningDefinition {
  code: LatePaymentWarningCode;
  /** Stable API / verify response warning string. */
  apiMessage: string;
  /** Receipt + PDF banner title. */
  title: string;
  /** Receipt + PDF banner body. */
  body: string;
  /** Seller timeline alert copy. */
  timelineCopy: string;
}

export const LATE_PAYMENT_WARNING_DEFINITIONS: Record<
  LatePaymentWarningCode,
  LatePaymentWarningDefinition
> = {
  PAYMENT_RECEIVED_AFTER_EXPIRY: {
    code: 'PAYMENT_RECEIVED_AFTER_EXPIRY',
    apiMessage: 'Payment was received after this invoice expired.',
    title: 'Payment received after invoice expiry',
    body: 'This transaction proves funds reached the seller after the original payment window.',
    timelineCopy: 'This payment arrived after the invoice had expired.',
  },
  PAYMENT_RECEIVED_AFTER_CANCEL: {
    code: 'PAYMENT_RECEIVED_AFTER_CANCEL',
    apiMessage: 'Payment was received after this invoice was cancelled.',
    title: 'Payment received after cancellation',
    body: 'This transaction proves funds reached the seller. Contact the seller to reconcile the payment.',
    timelineCopy: 'This payment arrived after the invoice had been cancelled.',
  },
};

export const LATE_PAYMENT_WARNINGS: Record<LatePaymentWarningCode, string> = {
  PAYMENT_RECEIVED_AFTER_EXPIRY:
    LATE_PAYMENT_WARNING_DEFINITIONS.PAYMENT_RECEIVED_AFTER_EXPIRY.apiMessage,
  PAYMENT_RECEIVED_AFTER_CANCEL:
    LATE_PAYMENT_WARNING_DEFINITIONS.PAYMENT_RECEIVED_AFTER_CANCEL.apiMessage,
};

export interface SettlementFields {
  settledAt: Date;
  settlementContext: SettlementContext;
  priorStatus?: InvoiceStatus;
  latePaymentWarningCode?: LatePaymentWarningCode;
}

export interface SettlementInvoiceState {
  status: InvoiceStatus | string;
  cancelledAt?: Date | string | null;
  expiresAt?: Date | string | null;
}

export class SettlementTimeUnavailableError extends Error {
  readonly code = 'TRANSACTION_CLOSE_TIME_UNAVAILABLE';

  constructor(
    message = 'Transaction close time is unavailable; try verification again later'
  ) {
    super(message);
    this.name = 'SettlementTimeUnavailableError';
  }
}

/**
 * Parse Horizon `created_at` / ledger close time as a UTC Date.
 * Returns null for missing or unparseable values — callers must fail closed
 * rather than inventing Date.now().
 */
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

/** Receipt / PDF title + body for a late-payment warning code. */
export function latePaymentWarningForCode(
  code?: string | null
): { title: string; body: string } | null {
  if (!code || !(code in LATE_PAYMENT_WARNING_DEFINITIONS)) {
    return null;
  }
  const def = LATE_PAYMENT_WARNING_DEFINITIONS[code as LatePaymentWarningCode];
  return { title: def.title, body: def.body };
}

/** Timeline alert copy for a late-payment warning code. */
export function timelineCopyForLatePayment(code?: string | null): string | null {
  if (!code || !(code in LATE_PAYMENT_WARNING_DEFINITIONS)) {
    return null;
  }
  return LATE_PAYMENT_WARNING_DEFINITIONS[code as LatePaymentWarningCode].timelineCopy;
}

/**
 * Classify settlement from ledger close time versus stored deadlines.
 *
 * Boundary rule (LATE_PAYMENT_POLICY.md): at exactly expiresAt or cancelledAt
 * the payment is late (>=). Missing close time throws — never falls back to
 * wall clock.
 */
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

  // PENDING or EXPIRED: ledger close time, not detection time, decides lateness.
  const expiresAt = parseSettlementTime(invoice.expiresAt);
  const afterExpiry = expiresAt
    ? settledAt.getTime() >= expiresAt.getTime()
    : invoice.status === 'EXPIRED';

  return {
    settledAt,
    settlementContext: afterExpiry ? 'AFTER_EXPIRY' : 'ON_TIME',
    priorStatus:
      invoice.status === 'EXPIRED' || afterExpiry
        ? (invoice.status as InvoiceStatus)
        : undefined,
    latePaymentWarningCode: afterExpiry ? 'PAYMENT_RECEIVED_AFTER_EXPIRY' : undefined,
  };
}
