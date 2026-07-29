# PaymentReceipt component (#78)

`PaymentReceipt` is the client-side presentation component for an invoice that the surrounding page already considers paid.
It receives the invoice object from its parent and renders payment-proof details and export actions without loading or updating invoice state itself.

## What it displays

The receipt opens with a confirmed-payment heading and the paid amount, formatted to seven decimals beside the invoice asset logo and code.
It shows the invoice description when present, plus the invoice ID and formatted payment date.
Optional seller and payer names and email addresses appear only when those invoice fields are available.
The transaction section includes the payment transaction hash, optional payer public key, seller public key, and memo.
The footer identifies the proof as a Stellar blockchain payment receipt powered by Quittance.

Both the invoice-detail and public payment pages render this component only when `invoice.status === 'PAID'`.
That status check is important because the component presents the supplied invoice as confirmed; it does not independently establish confirmation.

## Receipt actions

`Download Proof` passes the invoice to `openInvoicePDF`, which opens generated printable HTML in a new window and triggers the browser print dialog.
`Email Proof` is disabled when no customer email exists; otherwise `shareInvoiceByEmail` prepares a populated `mailto:` link for the user's mail client.
`View on Stellar Explorer` links the transaction hash to the testnet explorer only when `NEXT_PUBLIC_STELLAR_NETWORK` is `TESTNET`, and to the public explorer otherwise.
`Download TXT receipt` builds a plain-text summary in the browser, downloads it as `receipt-<invoice-id>.txt`, and revokes the temporary object URL.
The action controls are hidden when the page is printed.

## Boundaries

`PaymentReceipt` does not submit a Stellar transaction, poll for status, verify a transaction hash, or mutate the invoice.
Payment execution and invoice-status updates belong to the surrounding payment flow and API; this component only displays and exports the paid invoice data it receives.

## Where to look

- `frontend/components/PaymentReceipt.tsx` - receipt layout, conditional fields, explorer link, and text download.
- `frontend/lib/export.ts` - printable proof generation and email-sharing helpers.
- `frontend/components/AssetLogo.tsx` - asset icon rendered beside the paid amount.
- `frontend/app/invoice/[id]/page.tsx` - invoice-detail status gate that renders the receipt for paid invoices.
- `frontend/app/pay/[id]/page.tsx` - public payment-page status gate and paid-state refresh flow.
