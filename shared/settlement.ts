/**
 * Canonical invoice settlement contract shared by backend and frontend.
 *
 * Classifies on-chain payment settlement relative to invoice expiry and
 * cancellation timestamps, producing consistent settlement context, warning
 * codes, and user-facing copy.
 */

import type { InvoiceStatus } from './invoice';

export type SettlementContext = 'ON_TIME' | 'AFTER_EXPIRY' | 'AFTER_CANCEL';

export type LatePaymentWarningCode =
  | 'PAYMENT_RECEIVED_AFTER_EXPIRY'
  | 'PAYMENT_RECEIVED_AFTER_CANCEL';

export interface LatePaymentWarningDefinition {
  code: LatePaymentWarningCode;
  apiMessage: string;
  title: string;
  body: string;
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

/**
 * Mapping of late payment warning codes to API messages.
 */
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
  expiresAt?: Date | string | null;
  cancelledAt?: Date | string | null;
}


export class SettlementTimeUnavailableError extends Error {
  readonly code = 'TRANSACTION_CLOSE_TIME_UNAVAILABLE';

  constructor(message = 'Transaction close time is unavailable; try verification again later') {
    super(message);
    this.name = 'SettlementTimeUnavailableError';
  }
}

/**
 * Parses a candidate settlement timestamp into a valid Date instance or null.
 *
 * @param value - Candidate date, string, or number timestamp.
 * @returns Date instance if valid and finite, otherwise null.
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

/**
 * Retrieves the API warning message for a given late payment code.
 *
 * @param code - Late payment warning code.
 * @returns User-facing warning message string.
 */
export function warningForLatePayment(code: LatePaymentWarningCode): string {
  return LATE_PAYMENT_WARNINGS[code];
}

/**
 * Returns title and body copy for receipt or PDF rendering.
 *
 * @param code - Optional late payment warning code.
 * @returns Title and body strings, or null if code is absent or unrecognised.
 */
export function getLatePaymentWarning(
  code?: string | null
): { title: string; body: string } | null {
  if (!code || !(code in LATE_PAYMENT_WARNING_DEFINITIONS)) {
    return null;
  }
  const def = LATE_PAYMENT_WARNING_DEFINITIONS[code as LatePaymentWarningCode];
  return {
    title: def.title,
    body: def.body,
  };
}

/**
 * Returns timeline event copy for a given late payment code.
 *
 * @param code - Optional late payment warning code.
 * @returns Single-sentence copy, or null if code is absent or unrecognised.
 */
export function getLatePaymentTimelineCopy(code?: string | null): string | null {
  if (!code || !(code in LATE_PAYMENT_WARNING_DEFINITIONS)) {
    return null;
  }
  return LATE_PAYMENT_WARNING_DEFINITIONS[code as LatePaymentWarningCode].timelineCopy;
}

/**
 * Evaluates settlement context, prior status, and late payment warnings
 * by comparing ledger close time against invoice lifecycle milestones.
 *
 * @param invoice - Invoice state containing status, expiresAt, and cancelledAt.
 * @param settledAtInput - Ledger close time candidate.
 * @returns Evaluated settlement fields.
 * @throws SettlementTimeUnavailableError when close time or milestone time is missing.
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

  const expiresAt = parseSettlementTime(invoice.expiresAt);
  if (!expiresAt) {
    throw new SettlementTimeUnavailableError(
      'Invoice expiry time is unavailable; try verification again later'
    );
  }

  const afterExpiry = settledAt.getTime() >= expiresAt.getTime();
  return {
    settledAt,
    settlementContext: afterExpiry ? 'AFTER_EXPIRY' : 'ON_TIME',
    priorStatus: invoice.status === 'EXPIRED' ? 'EXPIRED' : undefined,
    latePaymentWarningCode: afterExpiry ? 'PAYMENT_RECEIVED_AFTER_EXPIRY' : undefined,
  };
}
