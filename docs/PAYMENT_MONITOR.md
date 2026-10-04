# Durable Horizon payment monitor

## Decision

The backend uses bounded polling of the account operations collection in
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
2. Ignore a record, audit a claimable balance, or verify its complete transaction.
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

## Path payments and claimable balances (#585)

The account operations feed includes ordinary payments, strict-send and
strict-receive path payments, and claimable-balance creation. Its operation
paging tokens preserve existing payment-feed checkpoints. Non-payment records
still advance the cursor; the first-run bootstrap policy remains unchanged.

For an incoming payment with an invoice memo, the monitor reuses the transaction
envelope observed during paging and loads its complete operation list once per
run. It calls the same `verifyHorizonPayment` used by `POST /api/invoices/:id/verify`.
The operation query explicitly requests 200 entries, covering the transaction's
full operation list instead of Horizon's default first page. A unique payment
to the seller is selected from the entire transaction; two matching payments
produce `AMBIGUOUS_PAYMENT_OPERATION`. Every page record is checkpointed even
when its transaction was already verified in the same run.

Path payments use the amount and asset received by the destination. Source XLM
spent, maximum source amount, and minimum destination amount do not determine
invoice settlement. Credit assets retain their actual code and issuer. An
account creation or merge to the invoice seller is audited as
`PAYMENT_REJECTED` with `UNSUPPORTED_PAYMENT_OPERATION` when the transaction has
no supported payment operation.

For a claimable-balance creation naming the monitored seller as claimant, a text
memo can identify a pending invoice. The creation effect provides the immutable
balance ID; the operation provides amount, asset and the seller's predicate.
The monitor records `CLAIMABLE_BALANCE_RECEIVED` and leaves the invoice pending.
A missing creation effect is retryable and prevents cursor advancement. The
seller feed shows the balance ID and a hint to claim it when its conditions
allow. The balance event itself never confirms invoice payment.

The `(invoice_id, balanceId)` partial unique index in `db/schema.sql`, together
with `ON CONFLICT DO NOTHING`, makes the event idempotent across PostgreSQL
cursor replay. Memory storage applies the same key within that storage instance.
Apply the schema before enabling the updated monitor.

### Reproducible evidence

`backend/tests/monitor-verify-parity.test.ts` runs all ten existing USDC cases
through the real Horizon service mapping, monitor, memory storage and HTTP
verify route. Legacy examples without memos receive a clearly synthetic invoice
context; network mismatch direction is normalized to the process's configured
network. The amount, asset and destination cases remain intact. The suite also
covers more than ten operations, ambiguous payment selection, unsupported
operations, claim-event replay and a missing creation effect.

`backend/tests/fixtures/monitor-testnet-receipts.json` retains fifteen exact HTTP
response bodies captured from public Testnet on 2026-10-04, with request URLs,
UTC capture times, byte counts and SHA-256 hashes. The four recorded transactions
are:

| Shape | Transaction hash | Memo and use |
| --- | --- | --- |
| XLM → USDC strict send | `2858162875b8bd6daf282b295961e7c80c2141865fae3029899ef2d2302a5196` | No memo; unchanged mapping test plus an explicitly synthetic memo-bearing derivative |
| XLM → USDC strict receive | `fd6fedc2c62153606a76e51ea237d2c234753b8f261d0184543b5b4bf75fdf76` | Original text memo `off_60cil8zxp`; unchanged envelope, constructed test invoice |
| Native claimable balance | `fa0af3ca5f2ba206daa5d35c99ba6356fac8eca9ff172e5a846efce67be61d12` | Original text memo `createclaimablebalance`; unchanged envelope, constructed pending invoice |
| USDC claimable balance | `50b1f59a29591a8937e22b929a81fe4eeeac6ccfc071e024cc4b8aae7d08fa4c` | No memo; additional raw asset and predicate receipt |

These are public operation-shape receipts, not evidence of a live Quittance
invoice. No transactions were submitted for this capture. Re-capture with GET
requests to the URLs stored in each resource. Testnet resets and later balance
claims can invalidate live lookups; retain the original bodies rather than
rewriting them. The tests check the stored byte hashes and claimant-feed
membership. The wallet test in `frontend/tests/payment-monitor.test.js` covers
all three payment types, destination values, concurrent replay, one toast per
operation, and the claim hint.

Run the focused checks from the corresponding package directory:

```sh
# backend
node --import tsx --test tests/monitor-verify-parity.test.ts tests/payment-monitor-*.test.ts tests/server-mvp-payment-monitor.test.ts tests/invoice-cancel-payment-race.test.ts tests/usdc-verify-edge-cases.test.ts tests/payment-verification.test.ts
# frontend
node --test tests/payment-monitor.test.js tests/verify-rejection-label.test.js
```

The optional `backend/tests/claimable-event-postgres.integration.test.ts` uses
`DATABASE_URL` and an isolated schema to check concurrent duplicate writers,
schema replay, a fresh database connection, and preservation of other audit
events. It is skipped when no PostgreSQL test database is configured; the
memory replay check does not establish PostgreSQL durability.

### Recorded PostgreSQL acceptance

On 2026-10-04, `claimable-event-postgres.integration.test.ts` passed on source
`66f18e99a62c8373b5e487100d99f49368e2576f`: **1 passed, 0 failed, 0 skipped**.
The native runner used Node 24.21.0, npm 11.19.0 and PostgreSQL 16.15. Test time
was 93.757396 ms; total process time was 413.141959 ms. The case exercised
concurrent writes, schema replay, a new connection, pending invoice state,
a distinct balance ID, and preservation of unrelated audit events.

[Native run 37204455112, job 111442631510](https://github.com/woahwhattheheck/bounty-concierge/actions/runs/37204455112/job/111442631510)
retains the source checkout and output. Its Q585 PostgreSQL step succeeded;
the combined workflow later failed in a separate Q584 Horizon 404 fixture.

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
