// Invoice amount input parser.
// Normalises free-form amount strings entered by users into a canonical numeric
// value that the backend and formatter helpers can consume.

const MAX_AMOUNT = 999_999_999.99;

/**
 * Parse a user-supplied invoice amount string.
 *
 * @param raw - Raw amount input.
 * @returns Canonical numeric amount, or null when the input is empty/invalid.
 */
export function parseAmountInput(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }

  const value = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  if (value === '') {
    return null;
  }

  // Strip thousands separators and whitespace.
  const normalised = value.replace(/,/g, '').replace(/\s+/g, '');
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

  // Reject values with more than 7 decimal places (Stellar precision).
  if (parts[1] && parts[1].length > 7) {
    return null;
  }

  const parsed = Number(numeric);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  if (parsed > MAX_AMOUNT) {
    return null;
  }

  return parsed;
}
