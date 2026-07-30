# UserProfile connected wallet UI

`UserProfile` is the shared client-side menu shown after a wallet is connected.
It gives invoice, payment, proof, and dashboard pages a consistent wallet-session control.

The required `userWallet` prop supplies the public key displayed by the component.
When that value is missing, the component returns nothing and leaves connection UI to `WalletConnect`.
The closed menu shows a wallet label and a shortened address using the first six and last four characters.
Clicking the menu button toggles a dropdown and rotates the chevron to reflect its open state.

The dropdown shows the complete public key so the user can confirm which wallet is active.
Its dashboard action closes the menu before navigating to `/dashboard`.
Its disconnect action clears the persisted wallet store, calls the optional page callback, and closes the menu.
Page callbacks then handle local follow-up such as clearing local wallet state or reloading the dashboard.

A document-level mouse listener closes the dropdown when a click lands outside its container.
The effect removes that listener when the component unmounts.
The component does not request Freighter access, load balances, monitor payments, or connect a wallet.
Those connection and monitoring responsibilities stay in `WalletConnect` and the wallet store.

The home and dashboard headers switch between `WalletConnect` and `UserProfile` from shared store state.
Public pay and invoice-detail headers pass their local wallet value and disconnect callback into the same menu.
This keeps wallet identity controls available beside invoice and proof content without owning payment verification.

## Where to look

- `frontend/components/UserProfile.tsx` for menu state, navigation, and disconnect behavior.
- `frontend/components/WalletConnect.tsx` for connection, balance, and payment-monitor responsibilities.
- `frontend/lib/store.ts` for persisted wallet state and the disconnect action.
- `frontend/app/page.tsx` for the home-page header integration.
- `frontend/app/dashboard/page.tsx` for dashboard integration and reload behavior.
- `frontend/app/pay/[id]/page.tsx` for the payer-facing header callback.
- `frontend/app/invoice/[id]/page.tsx` for invoice-detail and proof-page usage.
