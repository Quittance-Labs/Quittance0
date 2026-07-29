# Payment QR code display (#46)

`QRCodeDisplay` is a presentation component for a value supplied by its caller.
It keeps QR rendering and clipboard feedback separate from invoice and payment state.

## Display contract

The component accepts a required value plus optional title, size, and copy visibility.
Values beginning with `data:image` are displayed directly as backend-provided images.
Other values become SVG QR codes with high error correction and an included margin.
The default size is 256 pixels, and the optional title appears above the code.
Copy controls are shown by default and display the same value encoded by the QR.
The handler delegates to `copyToClipboard`, shows success or error feedback, and clears its copied state after two seconds.

## Page integrations

After invoice creation, the home page renders the API response's `paymentUrl` at 180 pixels with a "Scan to pay" title.
The invoice detail page shows `paymentInfo.paymentUrl` at 200 pixels only for a pending invoice with payment information.
The public payment page prefers `stellarQrCode` over `paymentUrl` and renders the selected value at 220 pixels.
That payment-page QR is inside controls shown only for a pending invoice without an existing transaction hash.

## Boundaries

The component renders and copies the value it receives; its callers decide which value and invoice state are appropriate.
It does not fetch, create, cancel, or mutate invoices, connect wallets, or choose an asset or amount.
It does not create, sign, submit, or verify payments and does not move funds.

## Where to look

- `frontend/components/QRCodeDisplay.tsx` - rendering modes and copy feedback.
- `frontend/app/page.tsx` - post-creation payment URL and 180-pixel QR.
- `frontend/app/invoice/[id]/page.tsx` - pending-invoice payment URL and detail-page QR.
- `frontend/app/pay/[id]/page.tsx` - Stellar QR fallback order and public payment UI.
- `frontend/lib/utils.ts` - shared clipboard helper.
- `frontend/lib/payment-page-state.js` - payment-control visibility rules.
