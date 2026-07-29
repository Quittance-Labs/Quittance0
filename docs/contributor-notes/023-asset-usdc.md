# USDC asset code and issuer notes

USDC is a Stellar issued asset, not the network-native XLM asset.
Its identity is the pair of asset code `USDC` and an issuer public key.
Code alone is not enough because different issuers can use the same code.

Quittance currently lists a testnet USDC issuer in the frontend asset catalog:
`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
Treat that value as network-specific configuration, not a mainnet default.
Changing networks requires checking the expected issuer and user trustlines.

Invoice creation stores both `assetCode` and `assetIssuer` for issued assets.
Payment construction uses both fields to create the Stellar asset object.
The payer must have a trustline for that exact code-and-issuer pair.
The SEP-0007 payment QR also includes both fields for non-native assets.

Payment and proof views display the invoice asset code with the amount.
Contributors should keep the issuer attached throughout invoice persistence,
payment submission, Horizon inspection, and verification even when the UI
shows only `USDC`.

The current MVP verification route compares the operation asset code with the
invoice asset code. Do not interpret that check as issuer verification; review
the operation issuer whenever tightening payment verification.

## Where to look

- `frontend/lib/assets.ts` — testnet asset code, issuer, and display metadata.
- `frontend/components/InvoiceForm.tsx` — selected asset fields sent on create.
- `frontend/lib/stellar.ts` — trustline check and payment asset construction.
- `backend/src/utils/qrcode.ts` — code and issuer in SEP-0007 payment links.
- `backend/src/server-mvp.ts` — current invoice payment verification boundary.
- `backend/src/services/stellar.service.ts` — Horizon payment issuer capture.
- `frontend/components/PaymentReceipt.tsx` — paid invoice proof presentation.
