# PENDING invoice status

`PENDING` is the initial state for a newly created Quittance invoice.
It means that the invoice is still awaiting a matching Stellar payment.
The invoice remains payable while it is pending and its expiration time has
not passed.

The database schema allows four invoice states: `PENDING`, `PAID`, `EXPIRED`,
and `CANCELLED`. A pending invoice is not proof that money was received.
Payment confirmation requires the monitor to find the invoice by its memo,
then verify the amount and asset before recording the transaction.

When those checks succeed, the service records the transaction and changes
the invoice to `PAID`, storing the transaction hash and payer details.
The periodic expiration check changes a pending invoice to `EXPIRED` after
`expires_at` has passed. An explicit cancellation can change a still-pending
invoice to `CANCELLED`.

The MVP memory store also starts invoices as pending and marks overdue ones
expired during its expiration pass. The payment page polls while the invoice
is pending so that a confirmed payment can update the displayed state.

## Where to look

- `db/schema.sql` — status values, default, and expiration column.
- `backend/src/services/invoice.service.ts` — creation, payment, cancellation,
  and database expiration transitions.
- `backend/src/services/payment-monitor.service.ts` — memo, amount, and asset
  checks before a payment is accepted.
- `backend/src/storage/memory-storage.ts` — MVP pending and expiration logic.
- `frontend/app/pay/[id]/page.tsx` and `frontend/components/PaymentStatus.tsx` —
  pending polling and the user-facing waiting state.
