// Invoice amount input parser.
//
// Normalises free-form amount strings entered by users into a canonical numeric
// value that the backend and formatter helpers can consume.

const MAX_AMOUNT = 999_999_999.99;

/**
 * Parse a user-supplied invoice amount string.
 *
 * @param {string | number | undefined | null} value - Raw amount input.
 * @returns {number | null} Canonical numeric amount, or null when the input is empty/invalid.
 */
function parseInvoiceAmount(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const raw = typeof value === 'string' ? value.trim() : String(value);
  if (raw === '') {
    return null;
  }

  // Strip thousands separators and normalise decimal separator.
  const normalised = raw
    .replace(/,/g, '')
    .replace(/\s+/g, '');

  // Reject explicit negative sign anywhere.
  if (normalised.includes('-')) {
    return null;
  }

  const numeric = normalised.replace(/[^0-9.]/g, '');
  if (numeric === '' || numeric === '.') {
    return null;
  }

  const parts = numeric.split('.');
  if (parts.length > 2) {
    return null;
  }

  const parsed = Number(numeric);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  // Reject values with more than 7 decimal places (Stellar precision).
  if (parts[1] && parts[1].length > 7) {
    return null;
  }

  if (parsed > MAX_AMOUNT) {
    return null;
  }

  return parsed;
}

module.exports = { parseInvoiceAmount };
