// Proof export timestamp formatter.
//
// Formats timestamps used in payment proof exports so every PDF/email uses the
// same locale-friendly, sortable string.

/**
 * Format a timestamp for payment proof exports.
 *
 * @param {string | Date | number | undefined | null} value - Timestamp value.
 * @returns {string | null} Formatted timestamp string, or null when the input is invalid.
 */
function formatProofTimestamp(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

module.exports = { formatProofTimestamp };
