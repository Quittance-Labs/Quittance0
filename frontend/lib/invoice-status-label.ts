// Human-readable invoice status labels.
// Centralises the wording used by status badges and announcement regions so
// every page presents the same label for each invoice state.

const STATUS_LABELS: Record<string, string> = Object.freeze({
  PENDING: 'Waiting for Payment',
  PAID: 'Paid',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
});

/**
 * Return a short English label for an invoice status.
 *
 * @param status - One of `'PENDING'`, `'PAID'`, `'EXPIRED'`, `'CANCELLED'`.
 * @returns Human-readable label, or `'Unknown'` for unsupported values.
 */
export function statusLabel(status: unknown): string {
  const key = typeof status === 'string' ? status.trim().toUpperCase() : '';
  return STATUS_LABELS[key] ?? 'Unknown';
}
