export const INVOICE_MEMO_PREFIX = 'INV-';

/**
 * Validate that an invoice memo string starts with the canonical invoice memo prefix ('INV-').
 *
 * @param memo Candidate memo string or unknown value.
 * @returns True if the memo is a non-empty string starting with 'INV-'.
 */
export function hasInvoiceMemoPrefix(memo: unknown): boolean {
  if (typeof memo !== 'string' || memo.trim().length === 0) {
    return false;
  }
  return memo.startsWith(INVOICE_MEMO_PREFIX);
}

export default {
  hasInvoiceMemoPrefix,
  INVOICE_MEMO_PREFIX,
};
