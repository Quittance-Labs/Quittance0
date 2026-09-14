import type {
  InvoiceStatus,
  SettlementContext,
  LatePaymentWarningCode,
} from '../../../shared/invoice';
import { LATE_PAYMENT_WARNINGS } from '../../../shared/verification';

export interface SettlementClassificationInput {
  status: InvoiceStatus;
  expiresAt: Date | string;
  cancelledAt?: Date | string | null;
  ledgerCloseTime: Date | string;
}

export interface SettlementClassification {
  settlementContext: SettlementContext;
  priorStatus?: InvoiceStatus;
  latePaymentWarningCode?: LatePaymentWarningCode;
  warningMessage?: string;
  isLate: boolean;
}

export interface ProofNotice {
  title: string;
  body: string;
}

/**
 * Format a Date or ISO string as 'YYYY-MM-DD HH:mm UTC'.
 *
 * @param date - The Date instance or ISO-8601 string to format
 * @returns Formatted UTC string representation
 */
export function formatUtcDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

/**
 * Classify the settlement context of a matching Stellar payment according to
 * transaction ledger close time and invoice lifecycle state.
 *
 * @param input - Classification inputs including status, expiresAt, cancelledAt, and ledgerCloseTime
 * @returns The resulting settlement context, prior status if transitioning from a terminal state, and warnings
 */
export function classifySettlement(
  input: SettlementClassificationInput
): SettlementClassification {
  const ledgerMs = new Date(input.ledgerCloseTime).getTime();
  const expiresMs = new Date(input.expiresAt).getTime();
  const cancelledMs = input.cancelledAt ? new Date(input.cancelledAt).getTime() : undefined;

  if (!Number.isFinite(ledgerMs)) {
    throw new TypeError('Invalid ledgerCloseTime provided to classifySettlement');
  }
  if (!Number.isFinite(expiresMs)) {
    throw new TypeError('Invalid expiresAt provided to classifySettlement');
  }

  if (input.status === 'CANCELLED') {
    if (cancelledMs !== undefined && Number.isFinite(cancelledMs) && ledgerMs < cancelledMs) {
      return {
        settlementContext: 'ON_TIME',
        priorStatus: 'CANCELLED',
        isLate: false,
      };
    }

    return {
      settlementContext: 'AFTER_CANCEL',
      priorStatus: 'CANCELLED',
      latePaymentWarningCode: 'PAYMENT_RECEIVED_AFTER_CANCEL',
      warningMessage: LATE_PAYMENT_WARNINGS.PAYMENT_RECEIVED_AFTER_CANCEL,
      isLate: true,
    };
  }

  const isExpired = ledgerMs >= expiresMs;

  if (input.status === 'EXPIRED') {
    if (!isExpired) {
      return {
        settlementContext: 'ON_TIME',
        priorStatus: 'EXPIRED',
        isLate: false,
      };
    }

    return {
      settlementContext: 'AFTER_EXPIRY',
      priorStatus: 'EXPIRED',
      latePaymentWarningCode: 'PAYMENT_RECEIVED_AFTER_EXPIRY',
      warningMessage: LATE_PAYMENT_WARNINGS.PAYMENT_RECEIVED_AFTER_EXPIRY,
      isLate: true,
    };
  }

  if (isExpired) {
    return {
      settlementContext: 'AFTER_EXPIRY',
      latePaymentWarningCode: 'PAYMENT_RECEIVED_AFTER_EXPIRY',
      warningMessage: LATE_PAYMENT_WARNINGS.PAYMENT_RECEIVED_AFTER_EXPIRY,
      isLate: true,
    };
  }

  return {
    settlementContext: 'ON_TIME',
    isLate: false,
  };
}

/**
 * Generate canonical quittance proof wording for late-settled invoices.
 *
 * @param settlementContext - The immutable settlement context
 * @param params - Settlement timestamps and transaction hash
 * @returns Proof notice with title and body, or null if settlement was on time
 */
export function getLatePaymentProofNotice(
  settlementContext: SettlementContext | undefined,
  params: {
    settledAt: Date | string;
    expiresAt: Date | string;
    cancelledAt?: Date | string | null;
    txHash: string;
  }
): ProofNotice | null {
  if (!settlementContext || settlementContext === 'ON_TIME') {
    return null;
  }

  const settledStr = formatUtcDateTime(params.settledAt);
  const expiresStr = formatUtcDateTime(params.expiresAt);

  if (settlementContext === 'AFTER_EXPIRY') {
    return {
      title: 'Payment received after invoice expiry',
      body:
        `This payment settled on Stellar at ${settledStr}. The invoice expired at ${expiresStr}. ` +
        `The transaction proves that funds reached the seller; it does not change the original due date or confirm acceptance of late performance.\n\n` +
        `Transaction: ${params.txHash}`,
    };
  }

  if (settlementContext === 'AFTER_CANCEL') {
    const cancelledStr = params.cancelledAt
      ? formatUtcDateTime(params.cancelledAt)
      : 'cancellation';
    return {
      title: 'Payment received after cancellation',
      body:
        `This payment settled on Stellar at ${settledStr}. The seller cancelled the payment request at ${cancelledStr}. ` +
        `The transaction proves that funds reached the seller. Contact the seller to reconcile the payment.\n\n` +
        `Transaction: ${params.txHash}`,
    };
  }

  return null;
}
