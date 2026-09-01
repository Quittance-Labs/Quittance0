/**
 * Client mirror of the canonical verification contract (issue #224).
 *
 * The authority is `backend/src/services/payment-verification.ts`; this file
 * exists so the pay flow can reject malformed input before a round trip and
 * surface the exact code/message the server would return. Keep the codes and
 * messages here identical to the backend module.
 */

const VERIFICATION_MESSAGES = {
  MISSING_TX_HASH: 'Transaction hash is required',
  INVALID_TX_HASH: 'Transaction hash must be 64 hexadecimal characters',
  INVALID_PAYER_NAME: 'Payer name must be text',
  INVALID_PAYER_EMAIL: 'Payer email is invalid',
  PAYER_INFO_TOO_LONG: 'Payer information is too long',
  INVOICE_ALREADY_PAID: 'Invoice has already been paid',
  INVOICE_EXPIRED: 'Invoice has expired and can no longer accept payment',
  INVOICE_NOT_PENDING: 'Invoice is not pending',
  TRANSACTION_NOT_FOUND: 'Transaction not found on Stellar',
  NO_PAYMENT_OPERATION: 'No payment operation found in transaction',
  MEMO_MISMATCH: 'Memo mismatch',
  DESTINATION_MISMATCH: 'Payment destination mismatch',
  AMOUNT_MISMATCH: 'Amount mismatch',
  ASSET_MISMATCH: 'Asset mismatch',
  NETWORK_MISMATCH: 'Transaction is on a different Stellar network',
};

const MAX_PAYER_FIELD_LENGTH = 255;
const PAYER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/i;
const normalizeTransactionHash = (value) =>
  typeof value === 'string' ? value.trim() : '';

const failure = (code) => ({
  ok: false,
  code,
  error: VERIFICATION_MESSAGES[code],
});

/** A Stellar transaction hash is 64 hexadecimal characters. */
const isValidTxHash = (txHash) =>
  TX_HASH_PATTERN.test(normalizeTransactionHash(txHash));

/** Same order of checks as the backend, so both sides report the same first failure. */
const checkTxHash = (txHash) => {
  if (typeof txHash !== 'string' || txHash.trim().length === 0) {
    return failure('MISSING_TX_HASH');
  }

  const normalized = normalizeTransactionHash(txHash);
  if (!isValidTxHash(normalized)) {
    return failure('INVALID_TX_HASH');
  }

  return { ok: true, value: normalized };
};

const checkPayerInfo = (input) => {
  const { payerName, payerEmail } = input || {};

  if (payerName !== undefined && typeof payerName !== 'string') {
    return failure('INVALID_PAYER_NAME');
  }
  if (payerEmail !== undefined && typeof payerEmail !== 'string') {
    return failure('INVALID_PAYER_EMAIL');
  }

  const normalizedPayerName = (payerName && payerName.trim()) || undefined;
  const normalizedPayerEmail = (payerEmail && payerEmail.trim()) || undefined;

  if (normalizedPayerEmail && !PAYER_EMAIL_PATTERN.test(normalizedPayerEmail)) {
    return failure('INVALID_PAYER_EMAIL');
  }
  if (
    (normalizedPayerName ? normalizedPayerName.length : 0) > MAX_PAYER_FIELD_LENGTH ||
    (normalizedPayerEmail ? normalizedPayerEmail.length : 0) > MAX_PAYER_FIELD_LENGTH
  ) {
    return failure('PAYER_INFO_TOO_LONG');
  }

  return {
    ok: true,
    value: { payerName: normalizedPayerName, payerEmail: normalizedPayerEmail },
  };
};

/**
 * Resolve a stable rejection code to its canonical user-facing message.
 *
 * This is the single place the frontend maps a code from an error envelope to
 * English copy. Every page surface — pay page, invoice detail, dashboard, and
 * the shared API error layer — routes through it, so a code always renders the
 * same actionable sentence no matter which endpoint rejected it.
 */
const messageForCode = (code) =>
  (code && VERIFICATION_MESSAGES[code]) || undefined;

/**
 * Turn a failed verify request into the shared message.
 *
 * Prefers the code the server sent so the wording stays identical even when the
 * two sides drift; falls back to the server text, then a generic message.
 */
const resolveVerificationError = (error, fallback = 'Verification failed') => {
  const data = (error && error.response && error.response.data) || {};

  const canonical = messageForCode(data.code);
  if (canonical) {
    return canonical;
  }

  return data.error || (error && error.message) || fallback;
};

module.exports = {
  VERIFICATION_MESSAGES,
  messageForCode,
  failure,
  isValidTxHash,
  normalizeTransactionHash,
  checkTxHash,
  checkPayerInfo,
  resolveVerificationError,
};
