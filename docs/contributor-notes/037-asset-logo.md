# AssetLogo component

`AssetLogo` is the shared client component for displaying a Stellar asset identity.
It keeps invoice, payment, receipt, and history views consistent without owning asset selection or payment logic.

The required `code` prop is resolved through `getAssetByCode` in the asset catalog.
Known assets provide the logo URL, accessible asset name, and canonical code used by the component.
Unknown codes fall back to plain text, so an unfamiliar asset still has a readable label instead of a broken image.

The optional `size` prop controls the circular container and image dimensions and defaults to 24 pixels.
The wrapper adds a white background, border, shadow, padding, and rounded clipping around the image.
The Next.js image uses the asset name as alternative text and is rendered unoptimized with priority loading.
The optional `showName` flag defaults to true and adds the asset code beside the logo.
The optional `className` is applied to the outer result, including the unknown-code fallback.

Invoice creation shows the selected asset beside the form control while the catalog supplies its issuer.
Invoice cards and the public payment page use the logo to pair amounts with their asset codes.
The payment receipt uses it beside the confirmed amount before proof download, email, or explorer actions.
Transaction history uses a compact logo beside each sent or received amount.
The dashboard also uses it when grouping revenue by asset.

This component is presentation-only: invoice status, payment verification, and proof data remain in their existing flows.

## Where to look

- `frontend/components/AssetLogo.tsx` for rendering, defaults, and fallback behavior.
- `frontend/lib/assets.ts` for supported asset metadata and lookup.
- `frontend/components/InvoiceForm.tsx` for invoice asset selection.
- `frontend/components/InvoiceCard.tsx` for invoice summary usage.
- `frontend/components/PaymentReceipt.tsx` for confirmed-payment proof presentation.
- `frontend/components/TransactionHistory.tsx` and `frontend/app/dashboard/page.tsx` for history and revenue usage.
