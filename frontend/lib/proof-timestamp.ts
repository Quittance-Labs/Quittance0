import { format } from 'date-fns';

/**
 * Formats a date, timestamp, or ISO string for payment proof export.
 * Fallbacks cleanly to 'N/A' when input is null, undefined, or empty.
 */
export function formatProofTimestamp(
  date?: Date | string | number | null,
  pattern = 'PPpp'
): string {
  if (date === null || date === undefined || date === '') {
    return 'N/A';
  }

  const parsed = date instanceof Date ? date : new Date(date);
  if (isNaN(parsed.getTime())) {
    return 'Invalid Date';
  }

  return format(parsed, pattern);
}
