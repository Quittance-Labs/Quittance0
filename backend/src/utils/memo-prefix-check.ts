/**
 * Invoice memo prefix validator (issue #272).
 *
 * Memos for invoices must use invoice-style prefixes (e.g. `INV-`).
 * This helper provides a pure, dependency-free check for that prefix constraint.
 */

export const INVOICE_MEMO_PREFIX = 'INV-';

/**
 * Checks whether a given value is a string that starts with the required invoice memo prefix.
 *
 * @param memo The value to validate.
 * @returns true if memo is a string starting with 'INV-', false otherwise.
 */
export function hasInvoiceMemoPrefix(memo: unknown): memo is string {
  if (typeof memo !== 'string') {
    return false;
  }
  return memo.startsWith(INVOICE_MEMO_PREFIX);
}

export default {
  INVOICE_MEMO_PREFIX,
  hasInvoiceMemoPrefix,
};
