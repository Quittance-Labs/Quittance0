/**
 * Canonical Horizon payment verification (issue #224).
 *
 * Every verify path — MVP `/api/invoices/:id/verify`, the Postgres invoice
 * controller, and `stellar.service` — routes through this module so the four
 * checks (memo, destination, amount, asset) and the network guard stay
 * identical, and so every rejection carries the same code and message.
 *
 * The module is pure: callers fetch the transaction and operations from
 * Horizon and hand them in. See README.md "Payment verification contract".
 */

export type VerificationCode =
  | 'MISSING_TX_HASH'
  | 'INVALID_TX_HASH'
  | 'INVALID_PAYER_NAME'
  | 'INVALID_PAYER_EMAIL'
  | 'PAYER_INFO_TOO_LONG'
  | 'INVOICE_ALREADY_PAID'
  | 'INVOICE_NOT_PENDING'
  | 'TRANSACTION_NOT_FOUND'
  | 'NO_PAYMENT_OPERATION'
  | 'MEMO_MISMATCH'
  | 'DESTINATION_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'ASSET_MISMATCH'
  | 'NETWORK_MISMATCH';

/** User-facing message for every rejection code. Mirrored in `frontend/lib/verification.js`. */
export const VERIFICATION_MESSAGES: Record<VerificationCode, string> = {
  MISSING_TX_HASH: 'Transaction hash is required',
  INVALID_TX_HASH: 'Transaction hash must be 64 hexadecimal characters',
  INVALID_PAYER_NAME: 'Payer name must be text',
  INVALID_PAYER_EMAIL: 'Payer email is invalid',
  PAYER_INFO_TOO_LONG: 'Payer information is too long',
  INVOICE_ALREADY_PAID: 'Invoice has already been paid',
  INVOICE_NOT_PENDING: 'Invoice is not pending',
  TRANSACTION_NOT_FOUND: 'Transaction not found on Stellar',
  NO_PAYMENT_OPERATION: 'No payment operation found in transaction',
  MEMO_MISMATCH: 'Memo mismatch',
  DESTINATION_MISMATCH: 'Payment destination mismatch',
  AMOUNT_MISMATCH: 'Amount mismatch',
  ASSET_MISMATCH: 'Asset mismatch',
  NETWORK_MISMATCH: 'Transaction is on a different Stellar network',
};

export interface VerificationFailure {
  ok: false;
  code: VerificationCode;
  error: string;
}

export interface VerificationSuccess<T> {
  ok: true;
  value: T;
}

export type VerificationResult<T> = VerificationSuccess<T> | VerificationFailure;

/** Amount precision used by Stellar (7 decimal places). */
export const STROOP_PRECISION = 7;
const MAX_PAYER_FIELD_LENGTH = 255;
const PAYER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/i;

export function failure(code: VerificationCode): VerificationFailure {
  return { ok: false, code, error: VERIFICATION_MESSAGES[code] };
}

/** A Stellar transaction hash is 64 hexadecimal characters. */
export function isValidTxHash(txHash: unknown): boolean {
  return typeof txHash === 'string' && TX_HASH_PATTERN.test(txHash.trim());
}

/** Reject missing or malformed hashes before spending a Horizon round trip. */
export function checkTxHash(txHash: unknown): VerificationResult<string> {
  if (typeof txHash !== 'string' || txHash.trim().length === 0) {
    return failure('MISSING_TX_HASH');
  }

  const normalized = txHash.trim();
  if (!isValidTxHash(normalized)) {
    return failure('INVALID_TX_HASH');
  }

  return { ok: true, value: normalized };
}

export interface PayerInfo {
  payerName?: string;
  payerEmail?: string;
}

/** Validate and normalize the optional payer fields sent with a verify request. */
export function checkPayerInfo(input: PayerInfo | Record<string, any>): VerificationResult<PayerInfo> {
  const { payerName, payerEmail } = input ?? {};

  if (payerName !== undefined && typeof payerName !== 'string') {
    return failure('INVALID_PAYER_NAME');
  }
  if (payerEmail !== undefined && typeof payerEmail !== 'string') {
    return failure('INVALID_PAYER_EMAIL');
  }

  const normalizedPayerName = payerName?.trim() || undefined;
  const normalizedPayerEmail = payerEmail?.trim() || undefined;

  if (normalizedPayerEmail && !PAYER_EMAIL_PATTERN.test(normalizedPayerEmail)) {
    return failure('INVALID_PAYER_EMAIL');
  }
  if (
    (normalizedPayerName?.length || 0) > MAX_PAYER_FIELD_LENGTH ||
    (normalizedPayerEmail?.length || 0) > MAX_PAYER_FIELD_LENGTH
  ) {
    return failure('PAYER_INFO_TOO_LONG');
  }

  return {
    ok: true,
    value: { payerName: normalizedPayerName, payerEmail: normalizedPayerEmail },
  };
}

/** Only a PENDING invoice may transition to PAID. */
export function checkInvoiceIsPayable(status: string): VerificationResult<null> {
  if (status === 'PAID') {
    return failure('INVOICE_ALREADY_PAID');
  }
  if (status !== 'PENDING') {
    return failure('INVOICE_NOT_PENDING');
  }
  return { ok: true, value: null };
}

/** What the invoice says the payment must look like. */
export interface ExpectedPayment {
  memo: string;
  amount: string | number;
  destination: string;
  assetCode: string;
  assetIssuer?: string;
  /** Network the invoice must be paid on, e.g. `TESTNET`. Server-configured. */
  network?: string;
}

export interface HorizonTransactionLike {
  memo?: string | null;
  memo_type?: string | null;
}

export interface HorizonOperationLike {
  type: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

export interface VerifiedPayment {
  txHash: string;
  from: string;
  to: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo: string;
}

export interface VerifyPaymentInput {
  txHash: string;
  expected: ExpectedPayment;
  transaction: HorizonTransactionLike;
  operations: HorizonOperationLike[];
  /**
   * Network the caller observed the transaction on, e.g. `TESTNET`. Clients send
   * their own network so a testnet payment cannot settle a pubnet invoice.
   * Skipped when either side is unknown.
   */
  network?: string;
}

function normalizeMemo(memo: unknown): string {
  return typeof memo === 'string' ? memo : '';
}

function assetCodeOf(operation: HorizonOperationLike): string {
  return operation.asset_type === 'native' ? 'XLM' : operation.asset_code ?? '';
}

export function amountsMatch(actual: unknown, expected: string | number): boolean {
  const actualAmount = parseFloat(String(actual));
  const expectedAmount = Number(expected);

  if (!Number.isFinite(actualAmount) || !Number.isFinite(expectedAmount)) {
    return false;
  }

  return actualAmount.toFixed(STROOP_PRECISION) === expectedAmount.toFixed(STROOP_PRECISION);
}

/**
 * Verify a Horizon transaction against what an invoice expects.
 *
 * Checks run in a fixed order so every caller reports the same first failure:
 * tx hash, network, payment operation, memo, destination, amount, asset.
 */
export function verifyHorizonPayment(input: VerifyPaymentInput): VerificationResult<VerifiedPayment> {
  const hashCheck = checkTxHash(input.txHash);
  if (!hashCheck.ok) {
    return hashCheck;
  }

  const { expected, transaction, operations, network } = input;

  if (expected.network && network && expected.network !== network) {
    return failure('NETWORK_MISMATCH');
  }

  const paymentOp = (operations || []).find((operation) => operation.type === 'payment');
  if (!paymentOp) {
    return failure('NO_PAYMENT_OPERATION');
  }

  if (normalizeMemo(transaction?.memo) !== normalizeMemo(expected.memo)) {
    return failure('MEMO_MISMATCH');
  }

  if (paymentOp.to !== expected.destination) {
    return failure('DESTINATION_MISMATCH');
  }

  if (!amountsMatch(paymentOp.amount, expected.amount)) {
    return failure('AMOUNT_MISMATCH');
  }

  const paidAssetCode = assetCodeOf(paymentOp);
  if (paidAssetCode !== expected.assetCode) {
    return failure('ASSET_MISMATCH');
  }

  // Non-native assets are only identical when the issuer matches too.
  if (expected.assetIssuer && paymentOp.asset_issuer !== expected.assetIssuer) {
    return failure('ASSET_MISMATCH');
  }

  return {
    ok: true,
    value: {
      txHash: hashCheck.value,
      from: paymentOp.from ?? '',
      to: paymentOp.to ?? '',
      amount: paymentOp.amount ?? '',
      assetCode: paidAssetCode,
      assetIssuer: paymentOp.asset_type === 'native' ? undefined : paymentOp.asset_issuer,
      memo: normalizeMemo(transaction?.memo),
    },
  };
}

export default {
  VERIFICATION_MESSAGES,
  failure,
  isValidTxHash,
  checkTxHash,
  checkPayerInfo,
  checkInvoiceIsPayable,
  verifyHorizonPayment,
};
