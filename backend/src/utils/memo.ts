import { customAlphabet, nanoid } from 'nanoid';
import {
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
} from '../../../shared/memo';

export {
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

const memoRandom = customAlphabet(MEMO_ALPHABET, 8);
const shortReferenceRandom = customAlphabet(MEMO_ALPHABET, 10);

/**
 * Generate a unique memo for invoice.
 * Format: INV-TIMESTAMP-RANDOM
 *
 * @returns An invoice memo guaranteed to satisfy isValidMemo and fit within 28 bytes.
 */
export const generateInvoiceMemo = (): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const memo = `INV-${timestamp}-${memoRandom()}`;
  if (!isValidMemo(memo)) {
    throw new Error(`Generated invoice memo is invalid: ${memo}`);
  }
  return memo;
};

/**
 * Generate short payment reference.
 *
 * @returns An uppercase random reference string.
 */
export const generateShortReference = (): string => {
  return shortReferenceRandom();
};

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
  generateInvoiceMemo,
  generateShortReference,
};
