/**
 * UTC date formatters for exported documents.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Coerces unknown date representations into a valid Date instance.
 *
 * @param value - Value to coerce.
 * @returns Valid Date instance, or null.
 */
function toDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Formats a date into UTC calendar date string: "MMM DD, YYYY".
 *
 * @param value - Timestamp or Date instance.
 * @returns Formatted UTC date string, or null when invalid.
 */
export function formatUtcDate(value) {
  const date = toDate(value);
  if (!date) return null;
  return `${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCDate())}, ${date.getUTCFullYear()}`;
}

/**
 * Formats a date into UTC date and time string: "MMM DD, YYYY, HH:mm UTC".
 *
 * @param value - Timestamp or Date instance.
 * @returns Formatted UTC date-time string, or null when invalid.
 */
export function formatUtcDateTime(value) {
  const date = toDate(value);
  if (!date) return null;
  const datePart = `${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCDate())}, ${date.getUTCFullYear()}`;
  return `${datePart}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}
