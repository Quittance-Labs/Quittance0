# TransactionHistory Component

`TransactionHistory` is a client component that shows recent Stellar payments for one public key.
The dashboard supplies the connected wallet address and requests up to 50 records.
The component defaults to 20 records when another consumer does not provide a limit.

When the public key changes, the component dynamically loads the Stellar server and queries Horizon.
Payments are ordered newest first and limited before the response is mapped for display.
Only payment and create-account operations are included in the local transaction list.
Each operation's parent transaction is fetched separately so its memo can be displayed and exported.

Direction is wallet-relative: a matching destination is received, and other operations are sent.
Native assets are labeled XLM; issued assets retain their code and optional issuer.
Rows show direction, shortened counterparty address, time, memo, amount, asset logo, and explorer link.
The explorer URL follows the configured Stellar network so testnet history stays on the testnet explorer.

The all, sent, and received filters control both visible rows and exported results.
CSV, PDF, and JSON exports use the shared export helpers and report failures through toast messages.
Loading, empty, refresh, and export-menu states are owned inside the component.

This is Horizon account history, not the source of truth for Quittance invoice status.
Invoice payment verification and downloadable proof use their own invoice and receipt flows.
The memo and transfer details shown here can help a contributor trace those related payments.

## Where to look

- `frontend/components/TransactionHistory.tsx` — Horizon query, mapping, filters, rows, and actions.
- `frontend/app/dashboard/page.tsx` — connected-wallet consumer and the requested record limit.
- `frontend/lib/stellar.ts` — configured Horizon server used by the dynamic import.
- `frontend/lib/export.ts` — CSV, PDF, and JSON transaction export helpers.
- `frontend/lib/utils.ts` — shortened Stellar address formatting.
- `frontend/components/AssetLogo.tsx` — asset mark rendered beside each amount.
