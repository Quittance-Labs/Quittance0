# In-memory to Postgres cutover

Status: implemented. The dual-backend entrypoint (`server-dual.ts`) is now live.
See [Issue #452](https://github.com/Kappa16/Quittance0/issues/452) for the
implementation PR.

## Decision

Quittance will switch invoice writes from one storage adapter to the other at a
single release boundary. It will not dual-write. The Postgres database is
loaded and verified before traffic moves, then becomes the only source of truth.

Local development keeps the existing npm run dev:mvp command and in-memory
adapter. Persistent environments use the full server with DATABASE_URL. The
`server-dual.ts` unified entrypoint honours the `INVOICE_STORAGE` env variable
to make the selection explicit:

| Environment | Command | INVOICE_STORAGE | Storage | Expected loss after restart |
| --- | --- | --- | --- | --- |
| Local UI work | npm run dev:mvp | (unset) | memory | accepted |
| Local UI work (dual) | npm run dev:dual | (unset) | memory (auto) | accepted |
| Local Postgres dev | npm run dev:dual | postgres | PostgreSQL | none |
| Ephemeral demo | npm run dev:mvp | (unset) | memory | accepted only when disclosed |
| Shared demo or production | npm run dev:dual | postgres | PostgreSQL | none after committed write |

A public demo can accept loss of invoices created since its last restart. Any
URL created before a planned production cutover has a zero-loss requirement:
freeze writes, export the live process, import once, verify, then route traffic.
If the memory process cannot export its current map, those links cannot be
recovered after the process stops. The cutover must therefore happen before
that stop.

---

## Empty-database boot (Issue #452 — Requirement 15)

Use this procedure when booting against a fresh PostgreSQL database for the
first time, or when provisioning a new environment.

### 1. Provision the database

Create a PostgreSQL database and capture its connection string:

```bash
createdb quittance
# or, in any Postgres environment:
psql -c "CREATE DATABASE quittance;"
```

Set the connection string in `backend/.env`:

```
DATABASE_URL=postgresql://user:password@localhost:5432/quittance
INVOICE_STORAGE=postgres
```

### 2. Apply the schema (idempotent)

```bash
cd backend
npm run db:migrate
```

The migration script (`db/schema.sql`) creates the invoices, transactions,
payment_events, and payment_monitor_checkpoints tables; adds all required
indexes; and adds the `payment_tx_hash` uniqueness constraint.  Re-running the
migration on an existing database is safe — every `CREATE TABLE`, `ALTER TABLE`,
and `CREATE INDEX` statement uses `IF NOT EXISTS`.

### 3. Verify the schema applied cleanly

```bash
psql "$DATABASE_URL" -c "\dt"
# Expected: invoices, transactions, payment_events, payment_monitor_checkpoints
```

### 4. Start the server

```bash
# Development (tsx watch):
npm run dev:dual

# Production (requires a prior npm run build):
npm run start:dual:prod
```

The server logs `Storage: PostgreSQL` on boot.  Health and readiness endpoints:

- `GET /api/health` → liveness (always 200)
- `GET /api/ready` → readiness (503 if critical config is missing)

### 5. Smoke test on the empty database

```bash
# Create one invoice, read it back, verify health and readiness:
DEPLOY_API_URL=http://localhost:3001/api node ../scripts/deploy-smoke.mjs
```

An empty database is fully valid.  No seed data is required for the server to
start or pass its readiness probe.

Optionally load the demo seed to see wallet-scoped data in the dashboard:

```bash
npm run db:seed
```

---

## Rollback to in-memory MVP (Issue #452 — Requirement 15)

These instructions switch an environment back to the in-memory backend without
touching the PostgreSQL database.

### Option A — set INVOICE_STORAGE=memory

If you are using `server-dual.ts` (the unified entrypoint), set the env variable:

```
INVOICE_STORAGE=memory
```

Restart the server.  The Postgres connection pool is never opened.  Invoices
created in memory will be lost on the next restart, which is the documented
behaviour of the memory backend.

### Option B — run the MVP-only entrypoint

Switch the start command to the in-memory-only server:

```bash
npm run dev:mvp       # development
npm run start:mvp:prod  # production
```

No environment changes are required.  The MVP server does not read
`INVOICE_STORAGE` and never opens a database connection.

### What happens to existing Postgres data after rollback?

The PostgreSQL database is not touched by the rollback.  Rows remain intact.
If you later re-enable Postgres, the same invoices reappear — including their
original `/pay/[id]` public identifiers.

**Do not route traffic back to a writable memory instance after Postgres has
accepted writes.**  That would fork invoice IDs and payment state.  The only
safe sequence is:

1. Disable writes to the Postgres server (drain mode or maintenance page).
2. Decide whether to keep Postgres as the source of truth, or
3. Accept that in-memory invoices created since the last cutover are lost on restart.

---

## Public identity contract

The following values are copied verbatim and remain immutable:

- id, which is the path segment for /pay/[id] and /invoice/[id];
- memo, which maps a Stellar transaction to one invoice;
- sellerPublicKey, which scopes dashboard history;
- status, paymentTxHash, payer fields, paidAt, createdAt, and expiresAt, which
  make an already-paid proof reproducible;
- amount, assetCode, and assetIssuer, which define what was paid.

Both current services create UUID v4 IDs, so no format translation is needed.
The importer must supply each existing ID explicitly and must never call either
service's ID or memo generator. Duplicate IDs or memos abort the import. They
must not be rewritten because that would silently break old URLs or payment
matching.

The frontend generates proof content from GET /api/invoices/:id. Proof files
are not stored separately. A stable row containing the same ID, status,
paymentTxHash, paidAt, amount, asset identity, seller, payer, and description is
therefore sufficient to preserve proof download and email behavior.

## Target table and ERD

The executable schema remains db/schema.sql. The review-only minimal draft is
docs/postgres-cutover-draft.sql and follows StoredInvoice exactly.

```mermaid
erDiagram
  INVOICES {
    uuid id PK
    varchar seller_public_key
    decimal amount
    varchar asset_code
    varchar asset_issuer
    text memo UK
    varchar status
    varchar payment_tx_hash
    timestamptz created_at
    timestamptz paid_at
    timestamptz expires_at
    jsonb metadata
  }
  TRANSACTIONS {
    uuid id PK
    uuid invoice_id FK
    varchar tx_hash UK
    bigint ledger
  }
  PAYMENT_EVENTS {
    uuid id PK
    uuid invoice_id FK
    varchar event_type
    jsonb event_data
  }
  INVOICES ||--o{ TRANSACTIONS : settles
  INVOICES ||--o{ PAYMENT_EVENTS : records
```

Required indexes are:

- primary key on id for public pay and invoice reads;
- unique index on memo for one-invoice payment mapping;
- seller_public_key plus created_at descending for wallet history;
- partial expires_at index where status is PENDING for expiry maintenance;
- unique payment_tx_hash when populated, to prevent one chain transaction from
  proving two invoices.

The existing schema has all but the last uniqueness rule. Add that rule only
after checking historical duplicates in the implementation PR.

## Shared storage contract (issue #555)

`InvoiceStorage` is the only write and read contract the invoice handlers use.
Memory and Postgres adapters implement every method on that interface — including
idempotent create (seller-scoped key lookup), public-id collision refusal,
`payment_tx_hash` claim on settle, cancel, and payment-event append. Handlers
must not branch on `storage.mode` or call a method that exists on only one
adapter.

Cutover rule: do not route production traffic to Postgres until the shared
handler suite (`backend/tests/invoice-handlers.test.ts`) passes against both
adapters with the same assertions, and the live Postgres integration test
(`invoice-postgres.integration.test.ts`, skipped unless `DATABASE_URL` is set)
asserts the same outcomes. Restart on Postgres must return the pending set a
memory process loses; that contrast is pinned in
`postgres-restart-persistence.test.ts`. Freighter remains the only identity —
cutover does not add a login gate.

## Query boundaries

Public payment and proof routes intentionally read one invoice by opaque UUID.
They must never expose list or search behavior.

Wallet routes require sellerPublicKey and include it in the database predicate:

| Operation | Required predicate |
| --- | --- |
| List dashboard invoices | seller_public_key = caller wallet |
| Statistics | seller_public_key = caller wallet |
| Cancel | id = requested id AND seller_public_key = caller wallet |
| Public pay or proof read | id = opaque public id |
| Verify payment | id = public id; chain destination must equal row seller |

The parity suite must run the same handler cases against both adapters. Add a
negative fixture in which seller A requests seller B's list, stats, and cancel
operation before cutover.

## Preflight and empty database boot

1. Merge shared StoredInvoice types and verify-hardening changes first.
2. Provision Postgres with backups and point DATABASE_URL at it.
3. Run npm run db:migrate twice; the second run must be a no-op.
4. Confirm invoices, transactions, and payment_events exist and the invoice
   columns match StoredInvoice.
5. Start the full server against the empty database.
6. Confirm /api/health reports postgres and /api/ready succeeds.
7. Create, read, verify, download proof, list, and cancel disposable invoices.
8. Delete the disposable database or rows before importing production data.

An empty database is valid. No seed is required for readiness or boot.

## Snapshot import

The cutover engine (`backend/src/services/cutover.service.ts` and CLI `backend/scripts/cutover.ts`) satisfies these properties:

1. **Drain Mode**: Set `CUTOVER_DRAIN_MODE=true` in environment. New invoice creations, cancellations, and payment simulations return `503 Service Unavailable`, while public pay links (`GET /pay/:id`, `GET /api/invoices/:id`) and proof downloads remain operational.
2. **Canonical Snapshot Export**: Exports in-memory invoices into a versioned JSON snapshot (`CutoverSnapshot` version `1.0`) with metadata (`exportedAt`, `source`, `count`, `checksum`). The SHA-256 checksum is computed over deterministically sorted invoices.
3. **Strict Validation**: Validates UUID v4 formatting (`isValidPublicInvoiceId`), Stellar StrKey public keys (`Keypair.fromPublicKey`), positive amounts, non-XLM asset issuer requirements, duplicate ID/memo collision detection, and PAID completeness invariants (`paymentTxHash` and `paidAt`).
4. **Transactional PostgreSQL Import**: Wraps import in `BEGIN ... COMMIT/ROLLBACK`. Checks for pre-existing database collisions on UUID or memo. Inserts invoices verbatim, and generates transaction and payment event records for paid invoices.
5. **Dry-Run Support**: Validates and executes full transaction against the target database, asserting zero collisions, and executes `ROLLBACK` to guarantee zero state modification.
6. **Parity Verification**: Compares source and target stores across ID, memo, seller key, amount, asset code, issuer, status, and payment hash.

### CLI Usage (`npm run cutover`)

```bash
# 1. Export in-memory invoices to canonical JSON snapshot
npm run cutover -- --export ./cutover-snapshot.json

# 2. Dry-run snapshot import (validates and rolls back transaction)
npm run cutover -- --import ./cutover-snapshot.json --dry-run

# 3. Atomically import into PostgreSQL
npm run cutover -- --import ./cutover-snapshot.json

# 4. Verify post-import byte-for-byte parity
npm run cutover -- --verify ./cutover-snapshot.json
```

No live request writes to both systems. The read-only window is the only planned
write outage.

## Cutover checklist

### Before routing traffic

- Shared storage contract and parity tests are green.
- Verify checks memo, destination, seven-decimal amount, asset code and issuer,
  and network.
- Database migration and snapshot import are complete.
- Imported IDs and memos match the export exactly.
- Seller A cannot list, count, or cancel seller B's invoices.
- Existing paid and pending URLs return the same JSON from Postgres.
- A paid invoice downloads a proof with the same tx hash and paidAt.
- Backups, DATABASE_URL, health checks, and alerting are configured.

### Traffic switch

1. Enable read-only mode on memory.
2. Take the final snapshot and import transaction.
3. Run count, digest, link, and cross-seller checks.
4. Deploy the full server or route the API hostname to it.
5. Keep memory read-only for one observation window.
6. Remove the old instance after the rollback window closes.

### Rollback

Stop new writes, keep the database, and route to the previous compatible full
server release. Do not route back to writable memory after Postgres accepted a
write; that would fork IDs and payment state. Schema changes for the first
cutover are additive, so an application rollback does not require a database
rollback.

If validation fails before traffic switches, discard the target rows, correct
the importer, and repeat from the same read-only snapshot.

## Compatibility acceptance

Before declaring the cutover complete, capture these examples from the old
server and compare them field-for-field with the new server:

- one PENDING /pay/[id] response and its payment URI;
- one PAID /pay/[id] response and downloadable proof;
- one /invoice/[id] seller detail response;
- wallet-scoped list and stats for two different sellers;
- one expired and one cancelled invoice;
- one issued-asset invoice including assetIssuer.

HTTP status, success envelope, field names, date serialization, amount
precision, and null-versus-omitted behavior are part of compatibility.

## Sequencing

1. Shared StoredInvoice and handler parity.
2. Canonical verify hardening.
3. Database constraints and snapshot tooling.
4. Dry run against a copy of a real snapshot.
5. Read-only import and traffic cutover.
6. Durable automatic payment monitoring.
7. Remove temporary export and drain endpoints after the rollback window.

This order prevents the importer from freezing an obsolete shape and ensures a
payment cannot be marked PAID under weaker rules during the cutover.
