# Dashboard invoice stats (#48)

The invoice dashboard summarizes invoices owned by the connected seller wallet.
It loads the seller's invoice list and statistics together when the dashboard opens.
The summary is scoped by the seller public key rather than by all platform invoices.

Total invoices counts every invoice for that seller, including cancelled invoices.
The statistics payload includes paid, pending, and expired counts.
The current dashboard cards show total, paid, pending, and revenue.
Cancelled invoices do not have a separate count field or summary card.
Changing the invoice-list status filter does not narrow these summary totals.

Revenue is calculated only from invoices whose status is paid.
Paid amounts are grouped by asset so different assets are never combined.
The database query treats a missing asset code as XLM when it builds the groups.
The dashboard sorts the asset groups by code before displaying them.
Each amount is shown to two decimal places beside the matching asset logo.
When no paid revenue exists, the dashboard displays a zero-value fallback.

These statistics help a seller orient within the invoice and payment flow.
They are a dashboard summary, not proof that a particular payment settled.
Payment-proof verification remains part of the separate invoice proof flow.

## Where to look

- `backend/src/services/invoice.service.ts` contains the database statistics query.
- `backend/src/storage/invoice-stats.ts` contains the in-memory aggregation helper.
- `frontend/app/dashboard/page.tsx` loads and renders the summary cards.
- `frontend/lib/api.ts` exposes the frontend request for seller statistics.
- `frontend/lib/mock-api.ts` mirrors the statistics shape for mock data.
