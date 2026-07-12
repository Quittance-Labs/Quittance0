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

## Quick start (MVP)

### Backend

```bash
cd backend
npm install
cp env.mvp.example .env
npm run dev:mvp
```

- API: `http://localhost:3001`  
- Health: `http://localhost:3001/api/health`  
- In-memory storage resets when the process restarts  

Optional: set `ALLOW_SIMULATE=true` in `.env` only for local fake payments (not for demos).

### Frontend

```bash
cd frontend
npm install
cp env.mvp.local .env.local
npm run dev
```

App: `http://localhost:3000`

### Env reference

- Backend: `backend/env.mvp.example`  
- Frontend: `frontend/env.mvp.local` / `frontend/env.example.txt`  

Set `FRONTEND_URL` on the backend to match the frontend origin (CORS).

---

## Demo & evidence

| Item | Status |
|------|--------|
| Public demo URL | TBD (Phase D) |
| Testnet tx hashes | TBD |
| Screen recording | TBD |

---

## Project layout

```
backend/     Express API — use server-mvp.ts for demo
frontend/    Next.js app
db/          Postgres schema (post-demo)
PLAN.md      Product & delivery plan
ROADMAP.md   Short commit checklist
```

---

## Docs policy

English only. Lean surface:

- `README.md` — overview and how to run  
- `PLAN.md` / `ROADMAP.md` — what we ship and in what order  
- Env example files — configuration  

---

## License

MIT — see [`LICENSE`](./LICENSE).
