export interface InvoiceLike {
  id?: string;
  createdAt?: string | number | Date | null;
  created_at?: string | number | Date | null;
  [key: string]: unknown;
}

/**
 * Computes a deterministic sort key for an invoice to ensure stable history ordering.
 * Invoices with newer timestamps will have higher sort keys.
 * Format: `<padded-timestamp>_<id>`
 */
export function sortKeyForInvoice(invoice?: InvoiceLike | null): string {
  if (!invoice || typeof invoice !== 'object') {
    return '';
  }

  const rawDate = invoice.createdAt ?? invoice.created_at;
  let timestamp = 0;

  if (rawDate instanceof Date) {
    timestamp = isNaN(rawDate.getTime()) ? 0 : rawDate.getTime();
  } else if (typeof rawDate === 'number') {
    timestamp = Number.isFinite(rawDate) ? rawDate : 0;
  } else if (typeof rawDate === 'string' && rawDate.trim() !== '') {
    const parsed = new Date(rawDate).getTime();
    timestamp = isNaN(parsed) ? 0 : parsed;
  }

  const id = typeof invoice.id === 'string' ? invoice.id : '';
  const paddedTime = String(Math.max(0, timestamp)).padStart(15, '0');
  return `${paddedTime}_${id}`;
}
