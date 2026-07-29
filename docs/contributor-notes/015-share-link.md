# Invoice share URL helpers (#58)

Quittance share URLs lead recipients to the public payment route `/pay/<invoice-id>`.
Several UI surfaces expose that route, but they do not all obtain the base URL in the same way.

## Canonical helper

`getShareUrl(invoiceId)` reads `NEXT_PUBLIC_APP_URL` and falls back to `http://localhost:3000`.
It appends `/pay/` and the invoice ID without loading or changing the invoice.
The invoice-detail page uses this helper for pending-invoice sharing.

When the Web Share API is available, the page supplies a Quittance title, the amount and asset as text, and the generated URL.
A rejected Web Share request is treated as a user cancellation.
Without Web Share support, the page writes the URL to the clipboard and shows a success toast.

## Other share surfaces

`InvoiceCard` builds the same payment-route shape from `window.location.origin` and offers its copy action only for pending invoices.
Its clipboard helper controls success or error feedback and a temporary copied state.
`shareInvoiceByEmail` requires a customer email and adds a current-origin payment URL when its paid transaction-information branch does not apply.
That helper opens an encoded `mailto:` URL rather than sending mail directly.

After invoice creation, the home page uses the API response's `paymentUrl` for the QR code, visible link, and clipboard copy.
Its optional Send action delegates the invoice to the email helper.

These different URL sources make the configured public base, current browser origin, and API-returned URL separate contracts to preserve.

## Boundaries

Share helpers construct or hand off URLs and presentation data.
They do not create, cancel, or mutate invoices, connect wallets, sign or initiate payments, verify transactions, or move funds.

## Where to look

- `frontend/lib/utils.ts` - `getShareUrl` and its public-base fallback.
- `frontend/app/invoice/[id]/page.tsx` - Web Share and clipboard fallback.
- `frontend/components/InvoiceCard.tsx` - pending-card copy URL and feedback.
- `frontend/lib/export.ts` - email body and `mailto:` handoff.
- `frontend/app/page.tsx` - API-returned payment URL, QR code, copy, and email entry points.
