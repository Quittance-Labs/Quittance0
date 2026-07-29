# Stellar payment memo on invoices (#45)

Quittance creates a text memo when an invoice is created and stores it with
that invoice. The current format starts with `INV-`, followed by an uppercase
base-36 timestamp and an uppercase random suffix. This makes the memo useful
as a compact correlation value without asking a payer to invent one.

When Quittance prepares a Stellar payment QR code, it includes the invoice
memo in the payment URI and marks it as `MEMO_TEXT`. The payment client uses
the same value as the transaction's text memo. Keeping those values aligned
lets the application associate the submitted transaction with the invoice.

The backend can look an invoice up by its stored memo. Payment verification
also compares the transaction memo with the invoice's expected memo before it
checks for a payment operation with the expected amount. A matching memo is
therefore one correlation check, not proof of payment by itself; transaction
and amount checks still matter.

Contributors should treat invoice memos as operational identifiers. Examples,
logs, and screenshots should use invented values rather than real invoice
data, and changes to memo handling should preserve the same value across
invoice creation, QR construction, payment submission, and verification.

## Where to look

- `backend/src/utils/memo.ts` generates and validates invoice memos.
- `backend/src/services/invoice.service.ts` stores and retrieves them.
- `backend/src/services/invoice-memory.service.ts` covers in-memory lookup.
- `backend/src/utils/qrcode.ts` adds a text memo to the payment URI.
- `frontend/lib/stellar.ts` attaches the memo to the Stellar transaction.
- `backend/src/services/stellar.service.ts` checks memo and payment amount.
