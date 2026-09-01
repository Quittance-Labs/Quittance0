import { nanoid } from 'nanoid';
import { hasInvoiceMemoPrefix, INVOICE_MEMO_PREFIX } from './memo-prefix-check';

/**
 * Generate a unique memo for invoice
 * Format: INV-TIMESTAMP-RANDOM
 */
export const generateInvoiceMemo = (): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = nanoid(8).toUpperCase();
  return `${INVOICE_MEMO_PREFIX}${timestamp}-${random}`;
};

/**
 * Validate memo format
 */
export const isValidMemo = (memo: string): boolean => {
  if (!hasInvoiceMemoPrefix(memo)) {
    return false;
  }
  return /^INV-[A-Z0-9]+-[A-Z0-9]+$/.test(memo);
};

/**
 * Generate short payment reference
 */
export const generateShortReference = (): string => {
  return nanoid(10).toUpperCase();
};

export { hasInvoiceMemoPrefix, INVOICE_MEMO_PREFIX };

export default {
  generateInvoiceMemo,
  isValidMemo,
  generateShortReference,
  hasInvoiceMemoPrefix,
  INVOICE_MEMO_PREFIX,
};

