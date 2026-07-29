# Payment proof HTML export (#47)

`generateInvoicePDF` turns a supplied invoice into printable HTML.
The result is an invoice or payment-proof view, not a binary PDF file.

## Exported content

The document includes invoice identity, status, customer and seller details, dates, amount, asset, description, memo, seller address, and network.
Optional identity fields appear only when the corresponding supplied values exist.
The network label is Testnet only when the public network setting is `TESTNET`; otherwise it is Mainnet.
For paid invoices, the template adds the payment date and a verified-payment banner.
Paid payer identity is conditional, and transaction hash and payer address rows require a supplied transaction hash.
The footer records when Quittance generated the printable invoice.

## Escaping and printing

`escapeHtml` replaces ampersands, angle brackets, double quotes, and single quotes before textual values enter markup.
That output escaping protects the HTML structure; it does not validate invoice data or verify a Stellar transaction.
`openInvoicePDF` writes the generated markup into a new browser window.
After that window loads, it opens the browser print dialog, where the user can save a PDF.
The export helper does not upload or persist the generated document.

## Boundaries

The exporter formats the invoice state and identity categories it receives without introducing real example data.
It does not fetch, create, cancel, or mutate invoices, connect wallets, or select payment details.
It does not create, sign, submit, or verify payments and does not move funds.

## Where to look

- `frontend/lib/export.ts` - escaping, printable invoice markup, and print-window handoff.
- `frontend/components/PaymentReceipt.tsx` - paid-receipt export action.
- `frontend/components/InvoiceCard.tsx` - invoice-card proof action.
- `frontend/app/pay/[id]/page.tsx` - public payment-page proof action.
- `frontend/app/invoice/[id]/page.tsx` - paid-invoice receipt placement.
