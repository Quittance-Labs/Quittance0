# Invoice CSV export helper

Quittance’s dashboard can export the currently filtered paid invoices as a
CSV file. The dashboard handles the user-facing guardrails first: it reports
when there are no matching invoices and only offers data to the exporter when
at least one invoice is `PAID`.

The exporter is split into a formatter and a browser download helper. The
formatter creates a stable header row, then maps each invoice into columns for
identity, dates, parties, description, amount, asset, status, payment details,
expiry, memo, and transaction hash.

Optional names, emails, descriptions, payer fields, and transaction hashes
become empty CSV cells when they are absent. Dates are formatted as
`yyyy-MM-dd HH:mm:ss`, which keeps the exported text sortable and easy to
import into a spreadsheet. Each cell is quoted so commas in a description do
not shift later columns.

The download helper prepends a UTF-8 byte-order mark for spreadsheet
compatibility, creates a `text/csv` Blob, and clicks a temporary link. Unless
the caller supplies a filename, the generated file is named with the current
date and time, such as `invoices-2026-07-28-143000.csv`.

This is a client-side export of the invoices already loaded in the dashboard;
it does not make a new payment request or change invoice state. The exported
transaction hash and payment date are references to recorded payment proof,
not a replacement for Stellar verification.

## Where to look

- `frontend/lib/export.ts` contains `generateInvoiceCSV` and `downloadInvoiceCSV`.
- `frontend/app/dashboard/page.tsx` filters paid invoices and starts the export.
- `frontend/components/InvoiceCard.tsx` shows invoice status and proof actions.
- `db/schema.sql` defines invoice status and payment-related columns.
- `frontend/lib/api.ts` provides the invoice data consumed by the dashboard.
