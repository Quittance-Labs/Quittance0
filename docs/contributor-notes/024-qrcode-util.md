# Backend QR code utility

The backend QR utility turns Quittance payment data into PNG data URLs for the client.
It exposes one helper for a normal web payment link and another for a Stellar payment request.

`generatePaymentQR` accepts the invoice's `/pay/{id}` URL and passes it to the `qrcode` package.
The result is a 300-pixel PNG data URL with medium error correction and a small margin.
This form lets a payer scan a browser route that opens the full Quittance payment page.
Generation failures are logged and returned to callers as a generic QR-code error.

`generateStellarPaymentQR` builds a SEP-0007 `web+stellar:pay` URI before rendering it.
The URI always carries the destination account and amount.
For a non-XLM invoice, it also includes the asset code and issuer when the issuer is available.
An invoice memo is URL-encoded and identified as a text memo.
The Stellar QR uses high error correction, a 400-pixel width, and a smaller margin.

Invoice creation and payment-info handlers generate both representations from the saved invoice.
Their API responses name them `qrCode` and `stellarQrCode` alongside the payment URL.
The payment page prefers the Stellar QR and falls back to the ordinary payment URL.
The frontend display renders backend `data:image` values directly and can generate an SVG for a URL.

The utility only encodes payment information; it does not create, submit, or verify a transaction.
Invoice validation and payment verification remain in the surrounding service and route layers.

## Where to look

- `backend/src/utils/qrcode.ts` defines both QR-generation helpers and their options.
- `backend/src/controllers/invoice.controller.ts` adds QR data to create and payment-info responses.
- `backend/src/server-mvp.ts` provides the same QR fields for the in-memory MVP routes.
- `backend/src/utils/validation.ts` validates invoice input before QR generation is reached.
- `frontend/lib/api.ts` fetches invoice and payment information from the backend.
- `frontend/components/QRCodeDisplay.tsx` renders backend images or generates an SVG fallback.
- `frontend/app/pay/[id]/page.tsx` selects the value shown in the payer QR panel.
