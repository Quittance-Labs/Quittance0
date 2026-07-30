# Freighter wallet connect on create and pay

Quittance uses the Freighter browser extension as the wallet entry point for both sides of an invoice.
The connected public key is also the user's lightweight identity; there is no separate account login.

On the create flow, the home page asks the seller to connect before it renders the invoice form.
The shared wallet component first checks whether Freighter is available, then requests wallet access.
After approval it reads the public key, loads the XLM balance, and stores that wallet state for the UI.
The seller's connected public key becomes the receiving address passed into the invoice form.

On the pay flow, the invoice page offers the same wallet connection control to the payer.
The payment button checks for Freighter again and requests access before constructing a payment.
Freighter signs the transaction after the payer confirms it in the extension.
The app then submits the signed transaction and asks the backend to verify the resulting hash.

Extension availability and wallet permission are separate checks.
If Freighter is missing, the UI shows an install prompt instead of attempting a payment.
If access is denied, the flow stops without reading a public key or signing a transaction.
For non-native assets, the payer also needs the matching trustline before payment can succeed.

## Where to look

- `frontend/app/page.tsx` gates invoice creation on the connected seller wallet.
- `frontend/app/pay/[id]/page.tsx` coordinates payer connection and the invoice payment view.
- `frontend/components/WalletConnect.tsx` handles availability, permission, public key, and wallet state.
- `frontend/components/PaymentButton.tsx` starts the payer-side permission, signing, and verification flow.
- `frontend/components/FreighterInstallPrompt.tsx` explains how to install a missing extension.
- `frontend/lib/stellar.ts` wraps Freighter access, transaction signing, and Stellar submission.
- `frontend/lib/store.ts` keeps the connected public key and balance available to the interface.
