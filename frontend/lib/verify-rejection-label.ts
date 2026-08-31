// Client-facing rejection label map for verification codes.
//
// Maps a verification code (from the shared backend/frontend contract) into
// a short, human-readable English label suitable for UI badges, toast titles,
// screen-reader announcements, and dashboard error summaries.
//
// Labels are kept distinct from the longer VERIFICATION_MESSAGES strings so
// badge-width layouts are not destroyed by the server's paragraph text. The
// code list must stay in sync with backend/src/services/payment-verification.ts
// and frontend/lib/verification.js.  Unknown codes fall back to a single
// generic label so callers never hand the UI a raw undefined.
//
// NOTE: despite the .ts extension this file intentionally contains ONLY plain
// JavaScript (type information lives in JSDoc comments).  CI runs on Node 20
// which ships without any built-in TypeScript loader or type-stripping; any
// TS-only keyword (type/export type/as/colon annotations) would crash the
// module load with SyntaxError.  The type alias below is a JSDoc @typedef so
// editors still surface it while Node's loader ignores it as a comment.
//
// @typedef {'MISSING_TX_HASH' | 'INVALID_TX_HASH' | 'INVALID_PAYER_NAME' |
//   'INVALID_PAYER_EMAIL' | 'PAYER_INFO_TOO_LONG' | 'INVOICE_ALREADY_PAID' |
//   'INVOICE_EXPIRED' | 'INVOICE_NOT_PENDING' | 'TRANSACTION_NOT_FOUND' |
//   'NO_PAYMENT_OPERATION' | 'MEMO_MISMATCH' | 'DESTINATION_MISMATCH' |
//   'AMOUNT_MISMATCH' | 'ASSET_MISMATCH' | 'NETWORK_MISMATCH' |
//   'UNKNOWN_VERIFICATION_ERROR'} VerificationCodeLabel

const UNKNOWN_LABEL = 'Unknown verification error';

/**
 * Short label text for each verification code.  Keys are the
 * `VerificationCodeLabel` union strings and values are the short English
 * strings rendered into UI chips and toast headers.
 *
 * Widened to `Record<string, string>` explicitly so TypeScript allows
 * string indexing via a runtime code string without the "no index
 * signature" error.  The explicit type annotation overrides the narrower
 * literal-key record inference that would otherwise apply.
 */
const REJECTION_LABELS: Record<string, string> = {
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
 * @param code      Verification code (from server or client-side preflight).
 *                  Accepts strings of unknown shape; anything unrecognized
 *                  yields the generic label.
 * @param fallback  Optional label returned instead of the generic default
 *                  when the code is unknown, missing, or empty.
 */
function rejectionLabel(code: string | null | undefined, fallback?: string): string {
  if (!code || typeof code !== 'string') {
    return typeof fallback === 'string' ? fallback : UNKNOWN_LABEL;
  }

  if (Object.prototype.hasOwnProperty.call(REJECTION_LABELS, code)) {
    return REJECTION_LABELS[code];
  }

  return typeof fallback === 'string' ? fallback : UNKNOWN_LABEL;
}

module.exports = {
  REJECTION_LABELS,
  rejectionLabel,
  default: rejectionLabel,
};
