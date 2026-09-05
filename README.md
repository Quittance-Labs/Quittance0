# Quittance

Invoice on Stellar. Get paid. Keep the proof.

Quittance helps freelancers create an invoice, accept payment via link or QR on Stellar, verify it on Horizon (memo + amount + destination), then **download or email payment proof**. Settlement stays on-chain. Quittance does not expose other people’s wallet identity or history.

**Sharp initial user:** freelancer invoicing a client in XLM/USDC on Stellar.

---

## What is shipped (v0.1 local / MVP)

| Capability | Status |
|------------|--------|
| Freighter wallet as identity (create + pay) | Done — no Google login gate |
| Create invoice + payment URL / QR | Done |
| Optional client email + Send invoice / Email proof (`mailto:`) | Done |
| Horizon-backed payment verify | Done (memo, amount, destination, asset) |
| Dashboard scoped to connected wallet | Done |
| Primary **Download Proof** CTA after paid | Done (PDF print flow in browser) |
| Simulate-payment UI | Removed from demo UI (`ALLOW_SIMULATE=true` only on API) |
| Public hosted demo + testnet evidence pack | Phase D (not yet) |
| Postgres persistence (wallet-scoped invoices) | Optional — see [Postgres persistence](#postgres-persistence-optional) |
| SMTP / Gmail API | After demo (Phase E) |

Ship plan: [`PLAN.md`](./PLAN.md).

---

## How it works

1. Connect Freighter and create an invoice (optional client name/email)  
2. Share the payment URL or QR — or **Send invoice** if email is set  
3. Client pays on Stellar (Freighter, QR, or manual transfer with the memo)  
4. `POST /api/invoices/:id/verify` checks the tx on Horizon  
5. **Download Proof** (primary) or **Email Proof** (if client email exists)  

Identity is the **wallet**. Email is an **optional delivery channel**, not a login gate.

---

## Wallet session contract

Freighter is the only wallet gate for create and pay. The frontend stores one
session snapshot in `frontend/lib/store.ts`: extension availability, public key,
active Freighter network, network passphrase, balance, and connection state.
`WalletSessionSync` refreshes that snapshot on every route and watches Freighter
for account or network changes without reloading the page.

Landing, dashboard, create, pay, and invoice-detail all use the same gate matrix:
install Freighter when the extension is missing, connect Freighter when no public
key is available, switch networks when Freighter is not on
`NEXT_PUBLIC_STELLAR_NETWORK`, and continue only when the wallet is connected on
the expected network.

---

## Payment verification contract

An invoice becomes `PAID` only when **all four checks pass** against Horizon:
**memo**, **destination**, **amount**, and **asset** (code *and* issuer for
non-native assets). A fifth guard rejects a transaction observed on a different
Stellar network.

One module owns these rules: [`backend/src/services/payment-verification.ts`](./backend/src/services/payment-verification.ts).
It is pure — the caller fetches the transaction and operations from Horizon and
passes them in. Every verify path routes through it, so the MVP and Postgres
handlers reject the same cases with the same wording:

| Path | Entry point |
|------|-------------|
| MVP (in-memory) | `POST /api/invoices/:id/verify` — `backend/src/server-mvp.ts` |
| Postgres | `POST /api/invoices/:id/verify` — `backend/src/routes/invoice.handlers.ts` |
| Standalone check | `POST /api/stellar/verify-payment` — `backend/src/services/stellar.service.ts` |
| Pay flow (client) | `frontend/lib/verification.js` — mirrors codes and messages |

Checks run in a **fixed order**, so every caller reports the same first failure:

```
tx hash → network → payment operation → memo → destination → amount → asset
```

Rejections return a stable `code` alongside the human-readable `error`:

| Code | Message | HTTP |
|------|---------|------|
| `MISSING_TX_HASH` | Transaction hash is required | 400 |
| `INVALID_TX_HASH` | Transaction hash must be 64 hexadecimal characters | 400 |
| `INVALID_PAYER_NAME` | Payer name must be text | 400 |
| `INVALID_PAYER_EMAIL` | Payer email is invalid | 400 |
| `PAYER_INFO_TOO_LONG` | Payer information is too long | 400 |
| `INVOICE_ALREADY_PAID` | Invoice has already been paid | 400 |
| `INVOICE_EXPIRED` | Invoice has expired and can no longer accept payment | 400 |
| `INVOICE_NOT_PENDING` | Invoice is not pending | 400 |
| `TRANSACTION_NOT_FOUND` | Transaction not found on Stellar | 404 |
| `NO_PAYMENT_OPERATION` | No payment operation found in transaction | 400 |
| `MEMO_MISMATCH` | Memo mismatch | 400 |
| `DESTINATION_MISMATCH` | Payment destination mismatch | 400 |
| `AMOUNT_MISMATCH` | Amount mismatch | 400 |
| `ASSET_MISMATCH` | Asset mismatch | 400 |
| `NETWORK_MISMATCH` | Transaction is on a different Stellar network | 400 |

The client mirror lets the pay page reject malformed input before a round trip
and show the exact message the server would return. A test asserts the two
tables stay identical — if you add a code, add it in **both** files.

Amounts compare at Stellar's 7-decimal (stroop) precision, so `100` and
`100.0000000` match while a partial payment does not.

Run the checks: `cd backend && npm test` — `cd frontend && npm test`.

### Invoice expiry lifecycle

Sellers choose a payment window of **1–30 days** (7 days by default). Both
storage backends persist `expiresAt` and lazily transition elapsed `PENDING`
invoices to `EXPIRED` before get, list, stats, verify, cancel, or monitor work.
Expired invoices remain visible in seller history, but they are excluded from
pending/actionable counts and cannot expose QR, pay, verify, or payment-proof
controls. The client also projects stale pending data through `expiresAt` so a
page fails closed while it waits for the next authoritative server response.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, TypeScript, Tailwind, Freighter |
| Backend (local / demo) | Express, TypeScript, **in-memory MVP** (`server-mvp.ts`) |
| Chain | Stellar testnet / public via Horizon |
| Later | PostgreSQL full server (`server.ts`, not required for v0.1) |

---

## Backend architecture

Both entrypoints share one invoice route layer. Only the storage adapter differs:

```
server-mvp.ts ─┐                                    ┌─ memory-invoice-storage.ts  (in-memory)
               ├─ routes/invoice.routes.ts ─ routes/invoice.handlers.ts ─ InvoiceStorage
server.ts ─────┘                                    └─ postgres-invoice-storage.ts (PostgreSQL)
```

- `src/routes/invoice.handlers.ts` — the only implementation of create / get / list / verify / cancel / stats / payment-info / simulate.
- `src/storage/invoice-storage.ts` — the `InvoiceStorage` interface both backends implement. Seller keys are always wallet-scoped: they come from the invoice payload or the `sellerPublicKey` query parameter, never from a static env key.
- `src/types/api.ts` — the shared `ApiResponse` envelope (`{ success, data, message?, pagination? }` or `{ success: false, error }`) used by every route on both servers.

A bug fix in a handler applies to both servers at once.

---

## Requirements

- Node.js 18+
- [Freighter](https://www.freighter.app/) for wallet flows — see [Freighter docs](https://docs.freighter.app/)
- Stellar testnet account for real payments ([Laboratory](https://laboratory.stellar.org/#account-creator?network=test))

PostgreSQL and Redis are **not** required for the MVP path below.

---

## Freighter testnet setup

1. Install the [Freighter browser extension](https://www.freighter.app/) and create or import a wallet.
2. Open Freighter's network menu and select **Testnet**. The official [Connect to the Testnet guide](https://developers.stellar.org/docs/build/guides/freighter/connect-testnet) shows the same flow.
3. Copy your public account address (it starts with `G`). Use Freighter's **Fund with Friendbot** prompt, or open Stellar Lab's [Fund Account page](https://lab.stellar.org/account/fund?network=testnet), paste the address, and select **Get testnet XLM**.

Only use your public `G...` address with Friendbot. Never paste a secret key or recovery phrase into a funding form. Testnet XLM has no real-world value and may disappear when Stellar resets Testnet.

---

## Quick start (local MVP)

Follow these steps from a fresh clone. Use **two terminals** so the backend and frontend can run at the same time.

```bash
git clone https://github.com/Kappa16/Quittance0.git
cd Quittance0
```

### 1) Backend API

```bash
cd backend
npm i
cp env.mvp.example .env
npm run dev:mvp
```

Keep this terminal running.

- API: `http://localhost:3001/api`
- Health check: `http://localhost:3001/api/health`
- MVP server entrypoint: `backend/src/server-mvp.ts`

Optional: set `ALLOW_SIMULATE=true` in `backend/.env` only for local fake payments (not for demos).

### 2) Frontend app

Open a second terminal from the repo root:

```bash
cd frontend
npm i
cp env.mvp.local .env.local
npm run dev
```

Open the app at `http://localhost:3000`.

### Local MVP notes

- The MVP backend is intentionally **in-memory**: invoices and payment state clear every time the backend process restarts.
- PostgreSQL and Redis are **not** needed for the local MVP path.
- `FRONTEND_URL` in `backend/.env` must match the frontend origin for CORS; the provided MVP env uses `http://localhost:3000`.
- `NEXT_PUBLIC_API_URL` in `frontend/.env.local` must include `/api`; the provided MVP env uses `http://localhost:3001/api`.

### Env reference

- Backend MVP template: `backend/env.mvp.example` → copy to `backend/.env`
- Frontend MVP template: `frontend/env.mvp.local` → copy to `frontend/.env.local`
- Full frontend template: `frontend/env.example.txt`

---

## Postgres persistence (optional)

Use this path when invoices must survive a backend restart. Identity is still the
connected Freighter wallet: every invoice is stored under its `seller_public_key`,
and list/stats endpoints only return the requesting wallet's invoices.

### 1) Point the backend at a database

In `backend/.env` (template: `backend/env.example.txt`):

```
DATABASE_URL=postgresql://user:password@localhost:5432/quittance
```

`SELLER_PUBLIC_KEY` / `SELLER_SECRET_KEY` are **optional**. They are only used by
the single-account Horizon payment monitor; without them the server starts in
wallet-scoped mode and the monitor stays off.

### 2) Migrate and seed

```bash
cd backend
npm run db:migrate   # applies db/schema.sql (idempotent, safe to re-run)
npm run db:seed      # optional: sample invoices for two demo wallets
```

- `db/schema.sql` — invoices, transactions, payment_events, `invoice_stats` view.
  Re-running it also drops the legacy `users` table and `invoices.user_id` column
  from older databases.
- `db/seed.sql` — invoices for two demo seller wallets so wallet scoping is
  visible locally. Swap a seed `seller_public_key` for your own Freighter address
  to see the rows in your dashboard.
- Runners: `backend/src/db/migrate.ts`, `backend/src/db/seed.ts`.

### 3) Run the Postgres backend

```bash
cd backend
npm run dev          # src/server.ts (Postgres) instead of dev:mvp (in-memory)
```

The dashboard sends the connected wallet on every call:
`GET /api/invoices?sellerPublicKey=G...` and `GET /api/invoices/stats?sellerPublicKey=G...`
both return `400` when the seller key is missing.

### 4) Tests

```bash
cd backend
npm run typecheck                                                     # TypeScript compile check (no emit)
npm test                                                              # unit + scoping + parity tests
npm run test:isolated                                                 # standalone regression tests in tests/isolated
DATABASE_URL=postgresql://user:password@localhost:5432/quittance_test npm test   # adds the Postgres integration test
```

The integration test (`backend/tests/invoice-postgres.integration.test.ts`) is
skipped unless `DATABASE_URL` is set. Point it at a disposable database — it
applies the schema, runs the seed twice to check idempotency, and writes rows
covering create, list, status filter, pagination, verify (markAsPaid with all
payer fields), expiry-time guard, cancel once-only, markExpiredInvoices lazy
transition, and the PostgresInvoiceStorage adapter end to end.

`npm test` also exercises the shared invoice handlers against both the in-memory
and PostgreSQL storage adapters, so create/verify/cancel/list/expiry/stats
regressions surface without a live database. Every backend path uses the same
`StoredInvoice` fields (seller metadata, asset issuer, expiry, payer info,
metadata) — the handler suite is parameterised over both adapters, so field
parity between memory and Postgres stays pinned by the same assertions.

---

## Deploy frontend (Vercel)

1. Create/import the project in Vercel and set **Root Directory** to `frontend`.
2. Keep the Next.js preset; `frontend/vercel.json` uses `npm ci`, builds `.next`,
   and applies the public security headers.
3. Add these variables to **Production** (and Preview when preview deploys should
   call the API):

| Variable | Example |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | `https://YOUR-API-HOST/api` |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `TESTNET` |
| `NEXT_PUBLIC_HORIZON_URL` | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_APP_URL` | `https://YOUR-APP.vercel.app` |
| `NEXT_PUBLIC_USE_MOCK` | `false` |

4. Run `npm run deploy:check` locally with the same variables before deploying.
5. Deploy. A missing/invalid production API URL fails closed in the UI with an
   explicit configuration warning; it never falls back to a visitor's localhost.

Templates: `frontend/env.example.txt`, `frontend/env.mvp.local`.

---

## Deploy backend MVP (Render)

Recommended host for `server-mvp.ts` (in-memory). `backend/vercel.json` now has
an optional serverless MVP entrypoint, but Render is the documented demo path
because it exposes normal liveness/readiness checks and predictable logs.

### Manual Web Service

1. Create a **Web Service** on [Render](https://render.com) from this repo.  
2. **Root Directory:** `backend`  
3. **Build:** `npm ci && npm run build`
4. **Start:** `npm run start:mvp:prod`
5. Health check path: `/api/ready` (`/api/health` remains liveness)
6. Environment variables:

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `production` |
| `STELLAR_NETWORK` | `TESTNET` |
| `STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` |
| `FRONTEND_URL` | `https://YOUR-APP.vercel.app` (exact frontend origin) |
| `FRONTEND_URLS` | Optional comma-separated preview/custom origins |
| `ALLOW_SIMULATE` | `false` |

`PORT` is set by Render automatically.

### Blueprint (optional)

`backend/render.yaml` is a complete Blueprint for this path. Set the unsynced
`FRONTEND_URL` value in Render; origins are exact and wildcards are rejected.

### After API is live

1. Copy the public API URL (e.g. `https://quittance-api.onrender.com`).  
2. Set frontend `NEXT_PUBLIC_API_URL` to `https://…/api` and redeploy Vercel.  
3. Confirm CORS: browser call from the Vercel origin to `/api/health` succeeds.
4. Confirm `GET /api/ready` returns HTTP 200 with `ready: true`.
5. Run the deployed create/read round-trip:

```bash
DEPLOY_API_URL=https://YOUR-API-HOST/api node scripts/deploy-smoke.mjs
```

The smoke command creates one tiny in-memory XLM invoice, reads it back, and
checks health/readiness. It never simulates or submits a Stellar payment.

### Safe deploy order

1. Reserve/deploy the Vercel project URL.
2. Configure that exact origin as Render `FRONTEND_URL`, then deploy Render.
3. Put the Render URL plus `/api` into Vercel `NEXT_PUBLIC_API_URL` and redeploy.
4. Run the smoke command and the browser checklist in `EVIDENCE.md`.

**Note:** Free-tier / in-memory means cold starts and process restarts clear all invoices. Fine for a short demo; document this for reviewers.

Env template: `backend/env.mvp.example`.

---

### Asset and verification contracts

A Stellar asset is the pair `(code, issuer)`, never the code alone — anyone can
issue a credit asset coded `USDC`, or even `XLM`. How invoices name assets and
how settlement compares them is documented in
[`docs/ASSETS.md`](./docs/ASSETS.md) and [`docs/VERIFY.md`](./docs/VERIFY.md).

## Tests & CI

Every pull request and every push to `main` runs the same three jobs defined in
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml). All of them are
reproducible locally with the commands below — CI runs nothing you cannot run
yourself.

```bash
# Backend: typecheck + unit and integration tests
cd backend && npm ci && npm run typecheck && npm test

# Frontend: lint + typecheck + unit tests
cd frontend && npm ci && npm run lint && npm run typecheck && npm test

# Frontend: focused axe, focus-management, live-region, and contrast checks
cd frontend && npm run test:a11y

# Shared export helpers (repository root)
node --test "tests/**/*.test.mjs"
```

The focused accessibility suite renders the landing, dashboard, pay, and
invoice-detail routes in jsdom, audits them with axe, and directly checks the
focus and live-region behavior that a static axe scan cannot observe. Because
jsdom has no layout engine, WCAG contrast ratios are verified separately from
the color pairs declared in `frontend/tailwind.config.js`.

### The invoice payment loop is covered end to end

`backend/tests/invoice-payment-loop.test.ts` exercises the whole core loop —
**create invoice → pay → verify → status `PAID`** — against the real Express
app, the real validation and the real in-memory store.

Horizon is the only thing replaced. The test starts a small stub on a loopback
port and points `STELLAR_HORIZON_URL` at it, so no network call leaves the
machine and the suite is deterministic. Alongside the happy path it pins the
rejections that protect a seller: a memo belonging to another invoice, a wrong
destination, a wrong amount, a wrong asset, and a second verification of an
invoice that is already paid.

If `verify` ever stops setting `PAID`, or starts accepting a payment it should
refuse, this test fails.

### Environment variables in CI

No secrets are required. The workflow sets only:

| Variable | Job | Why |
|---|---|---|
| `STELLAR_NETWORK=TESTNET` | backend | Never resolve mainnet configuration |
| `STELLAR_HORIZON_URL=http://127.0.0.1:1` | backend | Fail closed; the integration test overrides it with its own stub |
| `NEXT_PUBLIC_API_URL` | frontend | Build-time default for the client |
| `NEXT_PUBLIC_STELLAR_NETWORK=TESTNET` | frontend | Keep the client on testnet |

A plaintext Horizon URL is accepted **only** for a loopback address
(`backend/src/config/stellar.ts`), so a real deployment can never be downgraded
to HTTP by configuration.

For a manual testnet pass with a real Freighter payment, see
[`EVIDENCE.md`](./EVIDENCE.md).

---

## Demo & evidence

Reviewer pack: **[`EVIDENCE.md`](./EVIDENCE.md)** (URLs, testnet tx hashes, recording, tech note).

| Item | Status |
|------|--------|
| Public demo URL | Fill in `EVIDENCE.md` after deploy (D4) |
| Testnet tx hashes | Fill in after a real Freighter pay (D5) |
| Screen recording | Fill in after demo recording (D5) |

Until then, run locally: `backend` → `npm run dev:mvp`, `frontend` → `npm run dev`.

---

## Project layout

```
backend/     Express API — use server-mvp.ts for demo
  src/routes/    shared invoice route layer (both servers)
  src/storage/   InvoiceStorage: in-memory + PostgreSQL adapters
  src/services/payment-verification.ts — canonical verify rules
frontend/    Next.js app
             lib/verification.js — client mirror of the verify contract
db/          Postgres schema + seed SQL (runners: backend/src/db/)
PLAN.md      Product & delivery plan
ROADMAP.md   Short commit checklist
EVIDENCE.md  Public demo URL + testnet evidence (reviewer one-pager)
```

---

## License

MIT — see [`LICENSE`](./LICENSE).
