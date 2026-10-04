import type { InvoiceStatus } from './invoice';

export type { InvoiceStatus };

/**
 * Enumeration of all valid invoice statuses.
 */
export const INVOICE_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'] as const;

/**
 * Canonical transition table. Late settlement after cancel or expiry is legal
 * only when a ledger close time (`settledAt`) is present — see
 * `isLegalInvoiceTransition`.
 *
 * Forbidden examples:
 * - PAID → CANCELLED
 * - PAID → anything
 * - CANCELLED → CANCELLED / EXPIRED / PENDING
 * - EXPIRED → CANCELLED / EXPIRED / PENDING
 */
export const LEGAL_INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> =
  Object.freeze({
    PENDING: Object.freeze(['PAID', 'CANCELLED', 'EXPIRED'] as const),
    CANCELLED: Object.freeze(['PAID'] as const),
    EXPIRED: Object.freeze(['PAID'] as const),
    PAID: Object.freeze([] as const),
  });

/**
 * Statuses where the pay UI must not start or continue an interactive payment.
 * Late monitor/verify settlement may still move CANCELLED/EXPIRED → PAID.
 */
export const UI_TERMINAL_INVOICE_STATUSES = Object.freeze([
  'PAID',
  'EXPIRED',
  'CANCELLED',
] as const);

/**
 * Stable machine-readable error codes for rejected transitions.
 */
export type LifecycleErrorCode =
  | 'ILLEGAL_STATE_TRANSITION'
  | 'INVOICE_ALREADY_PAID'
  | 'INVOICE_EXPIRED'
  | 'INVOICE_NOT_PENDING'
  | 'INVOICE_NOT_FOUND'
  | 'TRANSACTION_CLOSE_TIME_UNAVAILABLE';

/**
 * Standard explanations mapped to lifecycle error codes.
 */
export const LIFECYCLE_ERROR_MESSAGES: Record<LifecycleErrorCode, string> = Object.freeze({
  ILLEGAL_STATE_TRANSITION: 'Illegal invoice state transition',
  INVOICE_ALREADY_PAID: 'Invoice has already been paid and cannot be modified',
  INVOICE_EXPIRED: 'Invoice has expired and can no longer accept payment or status changes',
  INVOICE_NOT_PENDING: 'Invoice is not pending',
  INVOICE_NOT_FOUND: 'Invoice not found',
  TRANSACTION_CLOSE_TIME_UNAVAILABLE:
    'Transaction close time is unavailable; try verification again later',
});

/**
 * Optional settlement proof required for late CANCELLED/EXPIRED → PAID.
 */
export interface TransitionValidationOptions {
  settledAt?: unknown;
}

/**
 * Error raised when an illegal or unsupported state change is attempted.
 * Message prefixes stay regex-compatible with older clients while `code` is
 * the stable API contract.
 */
export class IllegalStateTransitionError extends Error {
  readonly code: LifecycleErrorCode;
  readonly fromStatus: InvoiceStatus;
  readonly toStatus: InvoiceStatus;

  constructor(fromStatus: InvoiceStatus, toStatus: InvoiceStatus, customMessage?: string) {
    let code: LifecycleErrorCode = 'ILLEGAL_STATE_TRANSITION';
    let message = customMessage;

    if (fromStatus === 'PAID') {
      code = 'INVOICE_ALREADY_PAID';
      message =
        message ??
        (toStatus === 'CANCELLED'
          ? 'Invoice not found or already processed: Invoice has already been paid and cannot be cancelled'
          : 'Invoice not found, expired, or already processed: Invoice has already been paid');
    } else if (fromStatus === 'EXPIRED') {
      code = 'INVOICE_EXPIRED';
      message =
        message ??
        (toStatus === 'CANCELLED'
          ? 'Invoice not found or already processed: Invoice has expired and cannot be cancelled'
          : 'Invoice not found, expired, or already processed: Invoice has expired and can no longer accept payment');
    } else if (fromStatus === 'CANCELLED') {
      code = 'INVOICE_NOT_PENDING';
      message =
        message ??
        (toStatus === 'CANCELLED'
          ? 'Invoice not found or already processed: Invoice is already cancelled'
          : `Invoice not found, expired, or already processed: Cannot transition cancelled invoice to ${toStatus}`);
    } else {
      message =
        message ??
        (toStatus === 'CANCELLED'
          ? `Invoice not found or already processed: Cannot transition invoice from ${fromStatus} to CANCELLED`
          : `Invoice not found, expired, or already processed: Cannot transition invoice from ${fromStatus} to ${toStatus}`);
    }

    super(message);
    this.name = 'IllegalStateTransitionError';
    this.code = code;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

/**
 * Whether a transition between two statuses is permitted under current policy.
 */
export function isLegalInvoiceTransition(
  fromStatus: InvoiceStatus,
  toStatus: InvoiceStatus,
  options?: TransitionValidationOptions
): boolean {
  const allowed = LEGAL_INVOICE_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.includes(toStatus)) {
    return false;
  }
  if ((fromStatus === 'CANCELLED' || fromStatus === 'EXPIRED') && toStatus === 'PAID') {
    return Boolean(options?.settledAt);
  }
  return true;
}

/**
 * Asserts that a state transition is legal; throws IllegalStateTransitionError otherwise.
 */
export function assertLegalInvoiceTransition(
  fromStatus: InvoiceStatus,
  toStatus: InvoiceStatus,
  options?: TransitionValidationOptions
): void {
  if (!isLegalInvoiceTransition(fromStatus, toStatus, options)) {
    throw new IllegalStateTransitionError(fromStatus, toStatus);
  }
}

/**
 * Fully closed status: the transition table admits no further destinations.
 * Only PAID is fully terminal; CANCELLED/EXPIRED may still settle late.
 */
export function isTerminalInvoiceStatus(status: InvoiceStatus): boolean {
  const allowed = LEGAL_INVOICE_TRANSITIONS[status];
  return !allowed || allowed.length === 0;
}

/**
 * Pay-UI terminal: interactive payment must not start or continue.
 */
export function isUiTerminalInvoiceStatus(status: string): boolean {
  const normalized = typeof status === 'string' ? status.trim().toUpperCase() : '';
  return (UI_TERMINAL_INVOICE_STATUSES as readonly string[]).includes(normalized);
}
