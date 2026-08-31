// Pending-invoice classification helper.
//
// Dashboard stats need a single, consistent definition of "pending" so
// every consumer (invoice-stats aggregation today, other dashboard reads
// tomorrow) agrees on what counts. `isPendingInvoice` takes a minimal,
// structurally-typed shape rather than the full `StoredInvoice` so it can
// be used against both the raw storage record and the narrower
// `StatsInvoice` projection in `invoice-stats.ts` without re-mapping.
//
// Deliberately conservative: anything that is not exactly the literal
// status `'PENDING'` (including missing, empty, unknown, or differently
//-cased status values, and a missing invoice altogether) is treated as
// not pending. Silent misclassification of a non-pending invoice as
// pending would inflate `actionable_invoices` on the dashboard, so this
// helper never guesses.

export interface PendingCheckableInvoice {
  status?: string | null;
}

/**
 * Determine whether an invoice should be classified as pending for
 * dashboard stats purposes.
 *
 * @param invoice  The invoice to classify. Accepts any object with an
 *                 optional `status` field (e.g. `StoredInvoice` or the
 *                 narrower `StatsInvoice` projection), or `null`/`undefined`
 *                 for a missing invoice.
 * @returns        `true` only when `invoice.status` is exactly the string
 *                 `'PENDING'`. Returns `false` for `null`/`undefined`
 *                 invoices, a missing `status` field, an empty string, any
 *                 other known status (`PAID`, `EXPIRED`, `CANCELLED`), any
 *                 unrecognized status string, and non-exact-case matches
 *                 (e.g. `'pending'`).
 */
export function isPendingInvoice(
  invoice: PendingCheckableInvoice | null | undefined
): boolean {
  if (invoice == null) {
    return false;
  }

  return invoice.status === 'PENDING';
}

export default { isPendingInvoice };
