// Dashboard stats pending-invoice filter.
// Centralises the definition of "pending" used by invoice statistics so the
// dashboard and backend agree on which invoices are actionable. Only status
// is considered today, but having a dedicated helper lets future rules (e.g.
// expiry windows) be added in one place.

import type { StatsInvoice } from '../storage/invoice-stats';

/**
 * Determine whether an invoice should be counted as pending/actionable.
 *
 * An invoice is pending when its status is exactly `'PENDING'`. This helper
 * is intentionally narrow: expired, cancelled, and paid invoices are never
 * pending, and unknown statuses are rejected rather than assumed pending.
 *
 * @param invoice - Invoice subset used by the stats aggregator.
 * @returns true when the invoice counts toward pending stats.
 */
export function isPendingInvoice(invoice: StatsInvoice | null | undefined): boolean {
  return invoice?.status === 'PENDING';
}

export default {
  isPendingInvoice,
};
