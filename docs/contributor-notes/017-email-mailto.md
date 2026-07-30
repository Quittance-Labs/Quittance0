# Mailto send-invoice / send-proof

Quittance offers two ways to share an invoice with a client: copy the payment
link, or open a pre-filled email in the client’s mail application. The email
option is available after an invoice is created and only when a customer email
address was supplied.

The mail action is a browser-only convenience. It does not send mail from the
Quittance server and it does not expose the sender’s mailbox credentials. The
browser opens a `mailto:` URL addressed to the customer.

The subject includes the short invoice identifier, amount, and asset code.
The body includes the full invoice ID, amount, asset, current status, and any
optional customer name or description. For a pending invoice, the body links
to the payment page so the recipient can complete payment.

For a paid invoice, the body instead includes the payment date, transaction
hash, and payer address when available. It also states that payment was
verified on the Stellar blockchain. This keeps the email useful as a proof
handoff without pretending that the email itself is the verification source.

The helper URL-encodes the subject and body before assigning the `mailto:` URL.
If no customer email is present, it stops with a client-email-required error;
the caller should continue offering the copy-link path.

## Where to look

- `frontend/lib/export.ts` contains `shareInvoiceByEmail` and the email body.
- `frontend/app/page.tsx` renders the post-creation Send button.
- `frontend/components/InvoiceCard.tsx` exposes the same sharing action for cards.
- `frontend/app/pay/[id]/page.tsx` is the recipient payment page referenced for pending invoices.
- `frontend/components/PaymentReceipt.tsx` presents payment proof after confirmation.
