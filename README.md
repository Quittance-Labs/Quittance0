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
| Postgres persistence / SMTP / Gmail API | After demo (Phase E) |

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

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, TypeScript, Tailwind, Freighter |
| Backend (local / demo) | Express, TypeScript, **in-memory MVP** (`server-mvp.ts`) |
| Chain | Stellar testnet / public via Horizon |
| Later | PostgreSQL full server (not required for v0.1) |

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

## Deploy frontend (Vercel)

1. Import the GitHub repo in [Vercel](https://vercel.com).  
2. Set **Root Directory** to `frontend`.  
3. Framework preset: Next.js (see `frontend/vercel.json`).  
4. Add environment variables (Production):

| Variable | Example |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | `https://YOUR-API-HOST/api` |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `TESTNET` |
| `NEXT_PUBLIC_HORIZON_URL` | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_APP_URL` | `https://YOUR-APP.vercel.app` |
| `NEXT_PUBLIC_USE_MOCK` | `false` |

5. Deploy. After the API is live (Phase D2), point `NEXT_PUBLIC_API_URL` at it and set the backend `FRONTEND_URL` to this Vercel URL.

Templates: `frontend/env.example.txt`, `frontend/env.mvp.local`.

---

## Deploy backend MVP (Render)

Recommended host for `server-mvp.ts` (in-memory). Do **not** use `backend/vercel.json` for the demo — that targets the Postgres full server.

### Manual Web Service

1. Create a **Web Service** on [Render](https://render.com) from this repo.  
2. **Root Directory:** `backend`  
3. **Build:** `npm install`  
4. **Start:** `npm run start:mvp`  
5. Health check path: `/api/health`  
6. Environment variables:

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `production` |
| `STELLAR_NETWORK` | `TESTNET` |
| `STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` |
| `FRONTEND_URL` | `https://YOUR-APP.vercel.app` (exact frontend origin) |
| `ALLOW_SIMULATE` | `false` |

`PORT` is set by Render automatically.

### Blueprint (optional)

`backend/render.yaml` can be used as a starting point. Set `FRONTEND_URL` in the dashboard after the frontend URL is known.

### After API is live

1. Copy the public API URL (e.g. `https://quittance-api.onrender.com`).  
2. Set frontend `NEXT_PUBLIC_API_URL` to `https://…/api` and redeploy Vercel.  
3. Confirm CORS: browser call from the Vercel origin to `/api/health` succeeds.

**Note:** Free-tier / in-memory means cold starts and process restarts clear all invoices. Fine for a short demo; document this for reviewers.

Env template: `backend/env.mvp.example`.

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
frontend/    Next.js app
db/          Postgres schema (post-demo)
PLAN.md      Product & delivery plan
ROADMAP.md   Short commit checklist
EVIDENCE.md  Public demo URL + testnet evidence (reviewer one-pager)
```

---

## License

MIT — see [`LICENSE`](./LICENSE).
