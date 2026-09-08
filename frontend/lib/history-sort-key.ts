// Dashboard history sort key helper.
// Builds a stable sort key for dashboard invoice history so sorting behaviour
// is consistent across re-renders and locales.

interface InvoiceLike {
  createdAt?: string | number | Date;
  paidAt?: string | number | Date;
  expiresAt?: string | number | Date;
  amount?: string | number;
  status?: string;
}

/**
 * Build a sort key for an invoice history item.
 *
 * Uses createdAt by default; falls back to expiresAt, then paidAt, then 0.
 *
 * @param invoice - Invoice object.
 * @returns Numeric timestamp suitable for Array.prototype.sort.
 */
export function sortKeyForInvoice(invoice: unknown): number {
  if (!invoice || typeof invoice !== 'object') {
    return 0;
  }

  const candidateKeys: Array<keyof InvoiceLike> = ['createdAt', 'expiresAt', 'paidAt'];
  const inv = invoice as InvoiceLike;

  for (const key of candidateKeys) {
    const raw = inv[key];
    if (raw === undefined || raw === null || raw === '') {
      continue;
    }

    const time = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
    if (Number.isFinite(time)) {
      return time;
    }
  }

  return 0;
}
