# Quittance — Demo & Testnet Evidence

Reviewer-ready capture sheet for Phase D4–D5. Replace every `REQUIRED` slot
after deploying; do not submit the pack while a required slot remains.

---

## Public demo

| Item | Value |
|------|--------|
| Frontend | `REQUIRED: https://<project>.vercel.app` |
| API liveness | `REQUIRED: https://<service>.onrender.com/api/health` |
| API readiness | `REQUIRED: https://<service>.onrender.com/api/ready` |
| Network | Stellar **TESTNET** |
| Source revision | `REQUIRED: git commit SHA deployed to both services` |
| Captured at (UTC) | `REQUIRED: YYYY-MM-DDTHH:mm:ssZ` |

**How to try (≤ 3 min)**

1. Open the frontend URL; confirm no backend warning remains after cold start.
2. Open liveness and readiness URLs; capture HTTP 200 + JSON screenshots.
3. Connect Freighter on Testnet and fund the account if needed.
4. Create an XLM invoice → copy its payment link.
5. Pay with a second Freighter account on `/pay/[id]`.
6. Confirm **PAID** → **Download Proof** → verify it in dashboard history.

**Limits:** MVP API is in-memory. Process restarts clear invoices. Keep demos short.

---

## Testnet transactions

| # | Amount | Asset | Memo | Tx hash | Explorer |
|---|--------|-------|------|---------|----------|
| 1 (required) | `REQUIRED` | XLM | `REQUIRED` | `REQUIRED: 64-char hash` | `REQUIRED: https://stellar.expert/explorer/testnet/tx/<hash>` |
| 2 (optional retry) | `OPTIONAL` | XLM | `OPTIONAL` | `OPTIONAL` | `OPTIONAL` |

After a successful pay, copy the hash from the receipt or Freighter history.

---

## Screen recording

| Item | Value |
|------|--------|
| File / link | `REQUIRED: Loom, Drive, or repo release asset` |
| Length | Target ≤ 3 minutes |
| Script | Create → share/pay → verify → Download Proof → dashboard |

### Required video shots

- [ ] Browser address bar shows the public Quittance URL
- [ ] Freighter network is visibly Testnet (never expose a secret key)
- [ ] Invoice amount, memo, and destination are visible before signing
- [ ] PAID state and matching Stellar Expert transaction are shown
- [ ] Download Proof and seller-scoped dashboard history are shown
- [ ] No simulate-payment endpoint or mock mode is used

---

## Tech note (short)

- **Product:** Freelancer invoice → Stellar pay → payment proof (quittance)  
- **Identity:** Freighter wallet only (no Google login gate)  
- **Email:** Optional delivery (`mailto:` for Send invoice / Email proof)  
- **Verify:** `POST /api/invoices/:id/verify` loads the tx from Horizon and checks memo, amount, destination, and asset  
- **Seller model:** Each invoice stores the creator’s `sellerPublicKey` (dynamic wallet)  
- **Storage (demo):** In-memory MVP (`npm run start:mvp`) — not Postgres yet  
- **Deploy safety:** Render readiness validates origin/network/Horizon config;
  production forces `ALLOW_SIMULATE=false`
- **Proof:** Browser PDF (“Download Proof”) + optional email  

Ship plan: [`PLAN.md`](./PLAN.md).

---

## Checklist before SCF / external review

- [ ] All `REQUIRED` fields above are replaced and reachable
- [ ] `DEPLOY_API_URL=https://…/api node scripts/deploy-smoke.mjs` passes
- [ ] At least one real testnet tx hash linked  
- [ ] Recording uploaded and linked  
- [ ] CORS: `FRONTEND_URL` on API matches the live frontend origin  
- [ ] `ALLOW_SIMULATE=false` on production API  
- [ ] `/api/ready` says `ready: true`, `simulationEnabled` is false on health
- [ ] Incognito landing, dashboard, pay, and invoice-detail routes show explicit retry UI during a controlled API outage
