// Invoice memo prefix validator.
//
// Validates that a user-supplied memo begins with a configured prefix and obeys
// an optional maximum length. This is useful for forms or APIs that generate or
// consume memos which must match a brand or protocol prefix such as "Q0-".

const DEFAULT_PREFIX = 'Q0-';
const DEFAULT_MAX_LENGTH = 28;

/**
 * Validate that a value is a non-empty string beginning with the configured
 * prefix and, when requested, not longer than the configured maximum length.
 *
 * @param {unknown} value - Raw input value to validate.
 * @param {Object} [options] - Validation options.
 * @param {string} [options.prefix='Q0-'] - Required leading prefix.
 * @param {number|null} [options.maxLength=28] - Maximum allowed length after
 *   trimming. Use null to disable the length check.
 * @returns {{valid: true, normalized: string} | {valid: false, error: string}}
 *   Validation result. On success `normalized` contains the trimmed value.
 */
function validateInvoiceMemoPrefix(value, options = {}) {
  const prefix = options && typeof options === 'object' && 'prefix' in options
    ? String(options.prefix)
    : DEFAULT_PREFIX;
  const maxLength = options && typeof options === 'object' && 'maxLength' in options
    ? options.maxLength
    : DEFAULT_MAX_LENGTH;

  if (value === undefined || value === null) {
    return { valid: false, error: 'Memo is required.' };
  }

  if (typeof value !== 'string') {
    return { valid: false, error: 'Memo must be a string.' };
  }

  const normalized = value.trim();
  if (normalized === '') {
    return { valid: false, error: 'Memo is required.' };
  }

  if (!normalized.startsWith(prefix)) {
    return {
      valid: false,
      error: `Memo must start with "${prefix}".`,
    };
  }

  if (typeof maxLength === 'number' && normalized.length > maxLength) {
    return {
      valid: false,
      error: `Memo must be ${maxLength} characters or fewer.`,
    };
  }

  return { valid: true, normalized };
}

module.exports = { validateInvoiceMemoPrefix };
