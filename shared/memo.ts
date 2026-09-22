/**
 * Canonical memo contract, constants, and validators for Stellar invoice payments.
 *
 * Stellar text memos are capped at 28 bytes in UTF-8.
 * Invoice memos follow the format INV-TIMESTAMP-RANDOM over [A-Z0-9].
 */

export const STELLAR_MAX_MEMO_BYTES = 28;
export const INVOICE_MEMO_PREFIX = 'INV-';
export const MEMO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const MEMO_FORMAT_PATTERN = /^INV-[A-Z0-9]+-[A-Z0-9]+$/;

/**
 * Check whether a value is a string that starts with the invoice memo prefix.
 *
 * @param memo - The value to inspect.
 * @returns True when memo is a string starting with "INV-", otherwise false.
 */
export function hasInvoiceMemoPrefix(memo: unknown): boolean {
  if (typeof memo !== 'string') {
    return false;
  }
  return memo.startsWith(INVOICE_MEMO_PREFIX);
}

/**
 * Calculate the UTF-8 byte length of a string across Node and browser runtimes.
 *
 * @param memo - The string whose byte length is to be measured.
 * @returns Byte length in UTF-8.
 */
export function getMemoByteLength(memo: string): number {
  if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
    return Buffer.byteLength(memo, 'utf8');
  }
  return new TextEncoder().encode(memo).length;
}

/**
 * Check whether a string fits within Stellar's 28-byte text memo cap.
 *
 * @param memo - The value to inspect.
 * @returns True when memo is a string with byte length <= 28, otherwise false.
 */
export function isMemoByteLengthValid(memo: unknown): boolean {
  if (typeof memo !== 'string') {
    return false;
  }
  return getMemoByteLength(memo) <= STELLAR_MAX_MEMO_BYTES;
}

/**
 * Safely normalize a memo value into a string.
 *
 * @param memo - The value to normalize.
 * @returns The string value or empty string when non-string.
 */
export function normalizeMemo(memo: unknown): string {
  return typeof memo === 'string' ? memo.trim() : '';
}

/**
 * Validate that an invoice memo conforms to the full format and fits within Stellar's 28-byte limit.
 *
 * @param memo - The value to validate.
 * @returns True when valid, otherwise false.
 */
export function isValidMemo(memo: unknown): boolean {
  if (typeof memo !== 'string') {
    return false;
  }
  if (!hasInvoiceMemoPrefix(memo)) {
    return false;
  }
  if (!isMemoByteLengthValid(memo)) {
    return false;
  }
  return MEMO_FORMAT_PATTERN.test(memo);
}

/**
 * Check whether a Horizon or SEP-0007 memo_type string represents a text memo.
 *
 * @param memoType - The memo_type string to inspect.
 * @returns True when memoType is text or MEMO_TEXT, otherwise false.
 */
export function isTextMemoType(memoType: unknown): boolean {
  if (typeof memoType !== 'string') {
    return false;
  }
  const normalized = memoType.trim().toLowerCase();
  return normalized === 'text' || normalized === 'memo_text';
}

export default {
  STELLAR_MAX_MEMO_BYTES,
  INVOICE_MEMO_PREFIX,
  MEMO_ALPHABET,
  MEMO_FORMAT_PATTERN,
  hasInvoiceMemoPrefix,
  getMemoByteLength,
  isMemoByteLengthValid,
  normalizeMemo,
  isValidMemo,
  isTextMemoType,
};
