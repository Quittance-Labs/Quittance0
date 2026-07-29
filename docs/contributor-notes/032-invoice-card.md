# InvoiceCard UI responsibilities (#75)

`InvoiceCard` presents one invoice supplied by its parent dashboard; it does not fetch or update invoice data itself.
The dashboard filters its invoice collection and renders a card for each remaining item.

## Information shown

The header combines `AssetLogo`, the formatted amount and asset code, and a status badge styled by `getStatusColor`.
The customer name and description appear only when present, with long descriptions visually clamped to two lines.
Every card shows the formatted creation date.
Pending invoices also show the remaining time calculated from `expiresAt`.

## Status-specific actions

The View action is always available and links to `/invoice/<invoice-id>` for the full detail page.
The component builds the public `/pay/<invoice-id>` URL from the current browser origin.
Only pending invoices show the copy-link action.
`copyToClipboard` determines whether the card shows a success or error toast; a successful copy briefly swaps the icon and accessible label for two seconds.

Only paid invoices show `Download Proof`, which delegates the supplied invoice to `openInvoicePDF` for printable proof output.
Paid invoices also show an email-proof action that delegates to `shareInvoiceByEmail`.
The email action is disabled and labelled accordingly when the invoice has no customer email.

## Boundaries

The card is a presentation and navigation surface with local copy-feedback state.
It does not create, cancel, or mutate an invoice, connect a wallet, initiate or sign payment, verify a transaction, or move funds.
Payment status and proof data must already be present on the invoice supplied by the dashboard and API flow.

## Where to look

- `frontend/components/InvoiceCard.tsx` - card fields, status branches, links, and local copy feedback.
- `frontend/components/AssetLogo.tsx` - asset icon and fallback display.
- `frontend/lib/utils.ts` - amount, date, status, expiry, and clipboard helpers.
- `frontend/lib/export.ts` - printable proof and email-sharing helpers.
- `frontend/app/dashboard/page.tsx` - filtered invoice collection that renders the cards.
- `frontend/app/invoice/[id]/page.tsx` - detail route reached by the View link.
