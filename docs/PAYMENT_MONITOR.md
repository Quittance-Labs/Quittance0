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

### Restart hydration

Watches are in-memory, so a process restart used to empty the registry until the next `create`. On `start()` the monitor now runs a bounded hydrate pass **before** the first poll (issue #502):

- `listPendingInvoices` loads PENDING invoices from the active storage engine (memory or Postgres), scoped to the monitor account when a fixed seller is configured, otherwise all pending rows in MVP memory.
- The pass is capped at 500 invoices (`HYDRATE_WATCH_LIMIT`) — hydration never replays unbounded ledger history; the durable cursor remains the page position.
- Expired rows are transitioned first (`markExpiredInvoices`) and pruned again post-registration, so a lapsed invoice never comes back as a watch.
- Settlement stays keyed on memo + transaction hash, so a payment that landed during downtime settles exactly once — the PAID state and `processedTxHashes` make any replay harmless.

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

## Multi-seller wallet monitoring and leader lease (Issue #582)

### Multi-account watch set derivation

Rather than polling only a single pinned `SELLER_PUBLIC_KEY`, the payment monitor dynamically derives the set of accounts to poll by grouping active watched invoices by `sellerPublicKey`.
- `SELLER_PUBLIC_KEY` remains supported as an optional pinned account for single-seller deploys.
- Accounts are dynamically added and removed from the active polling loop as invoices transition through their lifecycle.
- When an account has no active watched invoices, it transitions to idle; its durable cursor is preserved in `payment_monitor_checkpoints` so subsequent invoices resume without rescan.

### Creation-aligned cursor bootstrapping

When an account is first encountered without an existing checkpoint, its cursor is bootstrapped at or before the earliest watched invoice's `createdAt` timestamp rather than anchoring to `now` (`getLatestPaymentCursor`). This ensures that payments landing on-chain between invoice creation and the account's first poll cycle are never skipped.

### Fair round-robin budgeting and isolated failure backoff

Accounts share the overall Horizon client concurrency and page budgets:
- Accounts are polled in round-robin order with bounded page allowances per tick.
- If Horizon calls for one account fail (rate-limiting, timeout, or network blip), that account enters exponential backoff (`monitorBackoffMs`) while other accounts continue polling and settling normally. A failing account delays other accounts by at most one tick.

### PostgreSQL advisory lock leader lease

In multi-replica environments with PostgreSQL storage:
- Replicas coordinate leadership via session-level PostgreSQL advisory locks (`pg_try_advisory_lock(742918452)`) on a dedicated pool connection.
- Exactly one elected process polls Horizon; other replicas continue serving HTTP requests in standby.
- On leader shutdown or process termination, PostgreSQL immediately releases the lock, allowing a standby replica to acquire the lease and resume monitoring with no double settlement.
- In-memory mode operates in single-instance mode and reports `singleInstance: true` and `leaderElection: 'single-instance'` in readiness probes.

### Operator endpoint authentication

`POST /api/payment/sync` is protected by an operator token:
- Replicas validate the token provided in `Authorization: Bearer <token>` or `X-Operator-Token: <token>`.
- Calls without a valid operator token return HTTP 401 Unauthorized.
- The expected token is configured via `OPERATOR_TOKEN` or `PAYMENT_MONITOR_OPERATOR_TOKEN` (defaulting to `test-operator-token` in development/test environments).

## Follow-ups

- Add an alert when lastSuccessAt exceeds the invoice page's polling window.
- Move settlement and cursor commit into one Postgres transaction if future side effects become non-idempotent.
