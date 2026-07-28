# PAID invoice status meaning

`PAID` means that Quittance has accepted a matching Stellar payment for the
invoice. It is a recorded application state, not merely a payer saying that a
transfer was attempted.

The payment flow starts from a pending invoice. The payer submits a
transaction hash, and the verification path checks the transaction against the
invoice’s expected memo and amount before recording payment details. A
successful update stores the transaction hash, payer address when available,
and the payment timestamp together with the `PAID` status.

The status is useful to both sides of the invoice. The pay page stops showing
payment controls and presents a receipt after the invoice becomes paid. The
invoice view can show the payment date and transaction hash, while the
dashboard can include the invoice in paid-invoice exports and statistics.

The transaction hash is the link back to Stellar evidence. A `PAID` label in
the UI should therefore be read together with the recorded hash and amount;
the label does not invent a payment or replace network verification.

Pending, expired, and cancelled are different lifecycle states. An invoice
that is still awaiting a matching transfer remains `PENDING`; an expired or
cancelled invoice is not treated as paid by the normal state transitions.

## Where to look

- `db/schema.sql` defines the invoice status, payment hash, payer, and paid-at columns.
- `backend/src/services/invoice.service.ts` persists the `PAID` transition.
- `backend/src/services/stellar.service.ts` verifies the transaction details.
- `backend/src/storage/memory-storage.ts` mirrors the in-memory update behavior.
- `frontend/app/pay/[id]/page.tsx` renders the payer flow and paid state.
- `frontend/components/PaymentReceipt.tsx` displays the resulting proof.
