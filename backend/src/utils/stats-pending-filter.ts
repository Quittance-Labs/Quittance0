// Pending invoice filter helper for stats and list aggregators.
//
// Ensures consistent classification of pending invoices across storage backends
// and dashboard statistics.

export const PENDING_STATUS = 'PENDING';

export interface PendingInvoiceCandidate {
  status?: string | null;
}

/**
 * Predicate to determine whether an invoice has a PENDING status.
 *
 * @param invoice - Invoice object or candidate with a status property.
 * @returns true if the invoice object is valid and its status is strictly 'PENDING', false otherwise.
 */
export function isPendingInvoice(
  invoice: unknown
): invoice is { status: 'PENDING' } {
  if (invoice === null || typeof invoice !== 'object') {
    return false;
  }

  return (invoice as PendingInvoiceCandidate).status === PENDING_STATUS;
}

export default {
  PENDING_STATUS,
  isPendingInvoice,
};
