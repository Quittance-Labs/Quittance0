// Proof export timestamp formatter.
// Formats timestamps used in payment proof exports so every PDF/email uses the
// same locale-friendly, sortable string.

/**
 * Format a timestamp for payment proof exports.
 *
 * @param value - Timestamp value.
 * @returns Formatted timestamp string, or null when the input is invalid.
 */
export function formatProofTimestamp(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const pad = (n: number): string => String(n).padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());
  const second = pad(date.getUTCSeconds());

  return `${year}-${month}-${day} ${hour}:${minute}:${second} UTC`;
}
