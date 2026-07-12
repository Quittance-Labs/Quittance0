# Quittance

Invoice on Stellar. Get paid. Keep the proof.

Quittance helps freelancers create an invoice, accept payment via link or QR on Stellar, verify it by memo + amount, then **download or email payment proof**. Settlement stays on-chain. Quittance does not expose other people’s wallet identity or history.

**Sharp initial user:** freelancer invoicing a client in XLM/USDC on Stellar.

---

## How it works

1. Connect Freighter and create an invoice  
2. Share the payment link or QR with your client  
3. Client pays on Stellar (Freighter, QR, or manual)  
4. Backend verifies memo + amount on Horizon  
5. Download proof (PDF) or send it by email (`mailto:` in v0.1)

Identity is the **wallet**. Email is an **optional delivery channel**, not a login gate.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, TypeScript, Tailwind, Freighter |
| Backend (demo / local) | Express, TypeScript, **in-memory MVP** |
| Chain | Stellar testnet / public, Horizon |
| Later | PostgreSQL full server (not required for v0.1 demo) |

Ship plan and commit order: [`PLAN.md`](./PLAN.md).

---

## Requirements

- Node.js 18+
- [Freighter](https://www.freighter.app/) (browser extension) for wallet flows
- Stellar testnet account for real payments ([fund via Laboratory](https://laboratory.stellar.org/#account-creator?network=test))

PostgreSQL and Redis are **not** required for the local MVP path below.

---

## Quick start (MVP)

### Backend

```bash
cd backend
npm install
cp env.mvp.example .env
npm run dev:mvp
```

API: `http://localhost:3001`  
Health: `http://localhost:3001/api/health`

In-memory storage resets when the process restarts.

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

When deployed, this section will list the live URL and sample testnet transaction hashes.

---

## Project layout

```
backend/     Express API (server-mvp.ts for demo)
frontend/    Next.js app
db/          Postgres schema (post-demo path)
PLAN.md      Product & delivery plan (source of truth for v0.1)
ROADMAP.md   Short commit checklist
```

---

## Docs policy

This repository keeps a **small English-only** doc surface:

- `README.md` — product overview and how to run  
- `PLAN.md` / `ROADMAP.md` — what we ship and in what order  
- `*.example` env files — configuration  

Overlapping setup guides were removed on purpose. For Freighter install and troubleshooting, use the [official Freighter docs](https://docs.freighter.app/).

---

## License

MIT — see [`LICENSE`](./LICENSE).
