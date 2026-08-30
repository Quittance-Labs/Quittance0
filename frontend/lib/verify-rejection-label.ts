// Client-facing rejection label map for verification codes.
//
// Maps a `VerificationCode` (from the shared backend/frontend contract)
// into a short, human-readable English label suitable for UI badges, toast
// titles, screen-reader announcements, and dashboard error summaries.
//
// Labels are kept distinct from the longer `VERIFICATION_MESSAGES` strings
// so badge-width layouts are not destroyed by the server's paragraph text.
// The code list must stay in sync with `backend/src/services/payment-
// verification.ts` and `frontend/lib/verification.js`. Unknown codes
// fall back to a single generic label so callers never hand the UI a raw
// `undefined`.

type VerificationCodeLabel =
  | 'MISSING_TX_HASH'
  | 'INVALID_TX_HASH'
  | 'INVALID_PAYER_NAME'
  | 'INVALID_PAYER_EMAIL'
  | 'PAYER_INFO_TOO_LONG'
  | 'INVOICE_ALREADY_PAID'
  | 'INVOICE_EXPIRED'
  | 'INVOICE_NOT_PENDING'
  | 'TRANSACTION_NOT_FOUND'
  | 'NO_PAYMENT_OPERATION'
  | 'MEMO_MISMATCH'
  | 'DESTINATION_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'ASSET_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'UNKNOWN_VERIFICATION_ERROR';

const UNKNOWN_LABEL = 'Unknown verification error';

export const REJECTION_LABELS: Record<VerificationCodeLabel, string> = {
  MISSING_TX_HASH: 'Transaction hash required',
  INVALID_TX_HASH: 'Invalid transaction hash',
  INVALID_PAYER_NAME: 'Invalid payer name',
  INVALID_PAYER_EMAIL: 'Invalid payer email',
  PAYER_INFO_TOO_LONG: 'Payer information too long',
  INVOICE_ALREADY_PAID: 'Invoice already paid',
  INVOICE_EXPIRED: 'Invoice expired',
  INVOICE_NOT_PENDING: 'Invoice not pending',
  TRANSACTION_NOT_FOUND: 'Transaction not found',
  NO_PAYMENT_OPERATION: 'No payment operation',
  MEMO_MISMATCH: 'Memo mismatch',
  DESTINATION_MISMATCH: 'Destination mismatch',
  AMOUNT_MISMATCH: 'Amount mismatch',
  ASSET_MISMATCH: 'Asset mismatch',
  NETWORK_MISMATCH: 'Network mismatch',
  UNKNOWN_VERIFICATION_ERROR: UNKNOWN_LABEL,
};

/**
 * Convert a verification failure code into a short UI-friendly label.
 *
 * @param code   A verification code as returned by either the server or the
 *               client-side preflight (`checkTxHash`, `checkPayerInfo`,
 *               `failure(...)`). Accepts strings of unknown shape so callers
 *               can pass a raw `data.code` from an axios error without a
 *               cast; anything unrecognized yields a generic label.
 *
 * @param fallback   Optional label returned instead of the generic default
 *                   when the code is unknown, null/undefined, or empty.
 *
 * @returns   A short English string. Never returns `undefined` / empty:
 *            missing input returns the fallback or the generic label.
 */
export function rejectionLabel(
  code: string | null | undefined,
  fallback?: string
): string {
  if (!code || typeof code !== 'string') {
    return fallback ?? UNKNOWN_LABEL;
  }

  const key = code as keyof typeof REJECTION_LABELS;
  if (Object.prototype.hasOwnProperty.call(REJECTION_LABELS, code)) {
    return REJECTION_LABELS[key];
  }

  return fallback ?? UNKNOWN_LABEL;
}

export default rejectionLabel;
