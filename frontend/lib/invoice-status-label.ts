/**
 * Human-readable English labels for invoice payment statuses.
 *
 * Centralising the wording keeps badges, status pages and screen-reader text
 * consistent across the app.
 */
export type InvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

const LABELS: Record<InvoiceStatus, string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

export function statusLabel(status: string): string {
  if (status in LABELS) {
    return LABELS[status as InvoiceStatus];
  }
  return 'Unknown';
}
