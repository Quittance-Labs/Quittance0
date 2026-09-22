# Durable Horizon payment monitor

## Decision

The backend uses bounded polling of the account payments collection in
ascending order. Each Horizon operation's paging token is committed only after
that operation has been handled. This is preferable to the previous
cursor-now stream because a reconnect resumes from a durable position and does
not lose payments that arrived during downtime.

Polling also gives the process one retry boundary for HTTP 429 responses,
timeouts, malformed or partial responses, and database failures. The regular
run is limited to 100 records per page and ten pages. A busy account continues
from its last committed token on the next run instead of performing an
unbounded rescan.

On the first run, the monitor stores the account's latest token and begins with
new operations. This avoids scanning the account's complete history. Existing
invoices can still use the explicit verify endpoint. Deploy migrations before
enabling the monitor.

## Durability

Postgres deployments store one row per account and network in
payment_monitor_checkpoints. The cursor advances after each handled record,
not at the end of a page:

1. Read the next ascending page after the stored cursor.
2. Ignore or verify one record.
3. Persist a matching transaction and move the invoice to PAID.
4. Commit that record's paging token and ledger.

A crash before step 4 replays the record. Replays are safe: transaction hashes
are unique and a PAID invoice cannot transition a second time. A crash before
settlement leaves the cursor untouched, so the payment is tried again.

The MVP can set PAYMENT_MONITOR_CURSOR_FILE to a local JSON path. Writes use a
temporary file plus rename, which preserves the cursor across process restarts.
This only makes the monitor position durable; invoices remain subject to the
selected storage adapter's persistence guarantees.

## Multi-invoice watch lifecycle and matching contract

The payment monitor maintains an active watch registry for pending invoices. Invoices enter the registry when created as PENDING, and are unregistered once settled (PAID), cancelled (CANCELLED), or expired (EXPIRED).

An incoming operation settles exactly one invoice selected by its unique memo. It then passes the shared verification contract:

- destination equals the invoice seller account;
- amount equals the invoice amount at seven decimal places;
- native XLM matches only native XLM;
- credit assets match both code and issuer;
- invoice status is still PENDING.

### One-transaction-to-one-invoice attribution

- A transaction hash can settle at most one invoice. If Horizon delivers a payment whose transaction hash was already claimed by another invoice, the monitor catches `PaymentClaimError`, logs an audit event `PAYMENT_REJECTED` (`TX_HASH_ALREADY_USED`), and prevents cross-attribution.
- If Horizon delivers a payment for an invoice that is already `PAID`:
  - If the incoming transaction hash matches `invoice.paymentTxHash`, the event is treated as an idempotent replay and safely skipped.
  - If the incoming transaction hash differs, the payment is rejected with audit code `INVOICE_ALREADY_PAID`.

A partial amount is recorded as PARTIAL_PAYMENT and leaves the invoice pending. Other mismatches are recorded as PAYMENT_REJECTED. Both are handled records, so they advance the cursor and cannot block later valid payments.

### Restart watch hydration contract

On startup (`PaymentMonitorService.start()`), the monitor hydrates its in-memory watch registry from the active storage engine (PostgreSQL or in-memory MVP) before resuming its durable polling loop:

1. **Storage Query**:
   - Queries `getPendingInvoices(sellerPublicKey, limit)` on the configured invoice service / storage engine.
   - Restricts queries strictly to invoices where `status = 'PENDING'` and `expires_at > NOW()`.
   - Scoped to the monitored seller account (`account` / `SELLER_PUBLIC_KEY`) when set; unscoped in MVP memory mode when running without a single seller filter.
2. **Bounded Hydration Pass**:
   - Strictly bounded by `hydrateLimit` (default `500`, configurable via `PAYMENT_MONITOR_HYDRATE_LIMIT` or constructor options).
   - Prevents memory exhaustion and avoids full ledger replay or unbounded database fetching.
3. **Cursor Preservation**:
   - Hydration populates the in-memory memo-to-invoice index; it does not alter or rewind the durable checkpoint cursor.
   - Polling resumes from the durable checkpoint cursor saved on disk or in the database.
4. **Lifecycle & Pruning**:
   - Watched invoices are automatically unregistered when transitioning to `PAID`, `CANCELLED`, or `EXPIRED`.
   - The expiration check interval prunes expired watches every 60 seconds.
5. **No Double-Settlement**:
   - Invoices hydrated on restart enforce the exact same single-settlement invariant. A payment transaction hash claimed by one invoice cannot settle any other invoice.

## Failure matrix and restart safety

| Failure | Cursor effect | Retry or operator signal | Invoice effect |
| --- | --- | --- | --- |
| Horizon 429 or timeout | unchanged | capped exponential retry; status reports retrying | unchanged |
| Invalid or partial Horizon page | unchanged from last complete record | same retry path | later records are not skipped |
| Transaction lookup failure | stops before that record | same retry path | unchanged |
| Database write failure | stops before that record | same retry path | unchanged or safely replayed |
| Crash after PAID, before cursor save | old token replays once | next process resumes automatically; duplicate hash skipped | remains PAID |
| Memo has no invoice | advances | no retry needed | unchanged |
| Partial or wrong payment | advances after audit event | visible in payment_events | remains PENDING |
| More than 1,000 queued operations | commits first bounded batch | next poll continues | no unbounded request |
| Duplicate paging tokens / pages | deduplicated against committed cursor | advances normally | no duplicate processing |

## Monitor status and lag visibility

Operators can inspect `GET /api/payment/monitor/status`. The status response exposes:
- `state`: `'stopped' | 'starting' | 'running' | 'retrying'`
- `account`: monitored seller public key
- `cursor`: durable committed paging token
- `ledger`: latest processed ledger sequence number
- `watchedCount`: number of pending invoices actively watched
- `lastPollAt`: ISO timestamp of the most recent poll attempt
- `lastSuccessAt`: ISO timestamp of the most recent successful poll
- `processedTotal`: cumulative count of processed Horizon payment records
- `lagSeconds`: elapsed seconds since the last successful poll
- `consecutiveFailures` & `nextRetryAt`: backoff state during Horizon interruptions

The pay page continues its invoice-status polling and manual verification path while the backend monitor retries, so a Horizon outage does not leave the user without a recovery action.

## Testnet restart evidence

Use a dedicated Testnet seller account and run the Postgres backend after
applying npm run db:migrate.

1. Start the backend and create an XLM invoice.
2. Wait until monitor status is running; record its cursor.
3. Stop the backend.
4. Pay the exact destination, memo, amount, and native asset on Testnet.
5. Start the backend again.
6. Record the transaction hash and confirm the invoice changes from PENDING to
   PAID; the monitor cursor must be greater than the value in step 2.

| Field | Value |
| --- | --- |
| Network | Testnet |
| Seller | GAA5INZB2GO3FJN4VXJYJSSIQXN4EKQTZWTR6R566TR3IMTXHSUDORLI |
| Cursor before stop | 19967736750809089 |
| Cursor after restart | 19967745340739585 |
| Transaction hash | 2ba24e8b095f6ecf7e4a2440afd11f5278f01e881dfcfe455e9e7a5766af77d6 |
| Before restart | PENDING |
| After restart | PAID |

This evidence was produced on 2026-09-13 with two ephemeral Friendbot-funded
accounts. The payment was submitted while the first monitor instance was down;
a new service instance loaded the earlier cursor and settled it.

The deterministic regression test in
backend/tests/payment-monitor-durable-cursor.test.ts forces the same restart
boundary with a shared durable checkpoint and asserts PENDING to PAID.

## Follow-ups

- Run one monitor per seller account when wallet-scoped automatic settlement is
  introduced; the current environment-key monitor remains a single-account
  deployment feature.
- Add an alert when lastSuccessAt exceeds the invoice page's polling window.
- Move settlement and cursor commit into one Postgres transaction if future
  side effects become non-idempotent.
