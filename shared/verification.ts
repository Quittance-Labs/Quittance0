/**
 * The canonical verification contract, shared by the backend API and the
 * Next.js client.
 *
 * Before this module the codes and messages existed twice: authoritatively in
 * `backend/src/services/payment-verification.ts`, and again as a
 * hand-maintained JavaScript mirror in `frontend/lib/verification.js`
 * whose own header told future editors to "keep the codes and messages here
 * identical to the backend module". Two lists that must be kept identical by
 * hand are two lists that eventually differ, and the failure mode is a pay
 * screen promising one thing while the server rejects for another.
 *
 * There is now one list. `backend/src/services/payment-verification.ts`
 * re-exports it and `frontend/lib/verification.js` re-exports it, and a
 * backend test asserts the backend's public surface still matches this module
 * exactly, so a reintroduced local copy fails the suite instead of shipping.
 */

/**
 * The four payment checks, in the fixed order the verifier must run them.
 *
 * Order is part of the contract, not an implementation detail: when a payment
 * fails several checks at once, the code the user sees depends on which check
 * ran first. Encoding the order here means both sides agree on it rather than
 * each inferring it from its own if-chain.
 */
export const VERIFICATION_CHECKS = [
  'memo',
  'destination',
  'amount',
  'asset',
] as const;

export type VerificationCheck = (typeof VERIFICATION_CHECKS)[number];

/** The stable set of rejection codes. */
export type VerificationCode =
  | 'MISSING_TX_HASH'
  | 'INVALID_TX_HASH'
  | 'INVALID_PAYER_NAME'
  | 'INVALID_PAYER_EMAIL'
  | 'PAYER_INFO_TOO_LONG'
  | 'VERIFY_RATE_LIMIT_EXCEEDED'
  | 'INVOICE_ALREADY_PAID'
  | 'INVOICE_EXPIRED'
  | 'INVOICE_NOT_PENDING'
  | 'TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_CLOSE_TIME_UNAVAILABLE'
  | 'VERIFY_UNAVAILABLE'
  | 'NO_PAYMENT_OPERATION'
  | 'AMBIGUOUS_PAYMENT_OPERATION'
  | 'MEMO_TYPE_MISMATCH'
  | 'MEMO_MISMATCH'
  | 'DESTINATION_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'AMOUNT_TOO_LOW'
  | 'AMOUNT_TOO_HIGH'
  | 'ASSET_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'TX_HASH_ALREADY_USED';

/**
 * The rejection code each check produces when it fails.
 *
 * `amount` is the one check with more than one outcome. Underpayment and
 * overpayment are separate codes (`AMOUNT_TOO_LOW`, `AMOUNT_TOO_HIGH`) and
 * `AMOUNT_MISMATCH` is what the check returns when the amount cannot be
 * compared at all, such as a non-numeric or missing value. Keeping that
 * fallback here means the map still answers which code each check in the
 * pipeline produces.
 */
export const CHECK_REJECTION_CODES: Record<VerificationCheck, VerificationCode> = {
  memo: 'MEMO_MISMATCH',
  destination: 'DESTINATION_MISMATCH',
  amount: 'AMOUNT_MISMATCH',
  asset: 'ASSET_MISMATCH',
};

/** The envelope a verification rejection is returned in. */
export interface VerificationFailureBody {
  success: false;
  code: VerificationCode;
  error: string;
}

/** User-facing message for every rejection code. */
export const VERIFICATION_MESSAGES: Record<VerificationCode, string> = {
  MISSING_TX_HASH: 'Transaction hash is required',
  INVALID_TX_HASH: 'Transaction hash must be 64 hexadecimal characters',
  INVALID_PAYER_NAME: 'Payer name must be text',
  INVALID_PAYER_EMAIL: 'Payer email is invalid',
  PAYER_INFO_TOO_LONG: 'Payer information is too long',
  VERIFY_RATE_LIMIT_EXCEEDED: 'Too many verification attempts for this invoice',
  INVOICE_ALREADY_PAID: 'Invoice has already been paid',
  INVOICE_EXPIRED: 'Invoice has expired and can no longer accept payment',
  INVOICE_NOT_PENDING: 'Invoice is not pending',
  TRANSACTION_NOT_FOUND: 'Transaction not found on Stellar',
  TRANSACTION_CLOSE_TIME_UNAVAILABLE: 'Transaction close time is unavailable; try verification again later',
  VERIFY_UNAVAILABLE: 'Verification is temporarily unavailable; try again within 30 seconds',
  NO_PAYMENT_OPERATION: 'No payment operation found in transaction',
  AMBIGUOUS_PAYMENT_OPERATION: 'Transaction contains more than one payment to the invoice destination',
  MEMO_TYPE_MISMATCH: 'Payment memo type is not a text memo',
  MEMO_MISMATCH: 'Memo mismatch',
  DESTINATION_MISMATCH: 'Payment destination mismatch',
  AMOUNT_MISMATCH: 'Amount mismatch',
  AMOUNT_TOO_LOW: 'Payment is less than the invoice amount',
  AMOUNT_TOO_HIGH: 'Payment is more than the invoice amount',
  ASSET_MISMATCH: 'Asset mismatch',
  NETWORK_MISMATCH: 'Transaction is on a different Stellar network',
  TX_HASH_ALREADY_USED: 'Transaction already settled another invoice',
};

/** The stable set of rejection codes, in declaration order. */
export const VERIFICATION_CODES: VerificationCode[] = Object.keys(
  VERIFICATION_MESSAGES
) as VerificationCode[];

/** The canonical user-facing message for a rejection code. */
export function messageForCode(code: VerificationCode): string {
  return VERIFICATION_MESSAGES[code];
}
