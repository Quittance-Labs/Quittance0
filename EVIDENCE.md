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

### Automated Testnet smoke pack

The backend package includes one command that performs the reviewer path
against a deployed API: health → readiness → create invoice → submit a real
Testnet XLM payment → verify → read back `PAID` → write a JSON artifact.

Required environment variables:

| Variable | Purpose |
|---|---|
| `EVIDENCE_API_URL` | Deployed HTTPS API URL ending in `/api` |
| `EVIDENCE_SELLER_PUBLIC_KEY` | Existing, funded Testnet recipient account |
| `EVIDENCE_PAYER_SECRET` | Existing, funded Testnet payer secret; never written to output |

These are required when `--write-evidence` updates this file:

| Variable | Purpose |
|---|---|
| `EVIDENCE_FRONTEND_URL` | Public reviewer frontend URL |
| `EVIDENCE_SOURCE_REVISION` | Commit deployed to frontend and API |

Optional variables are `EVIDENCE_AMOUNT` (default `0.1000000` XLM),
`EVIDENCE_HORIZON_URL`, and `EVIDENCE_OUTPUT` (default
`../artifacts/evidence-smoke.json` from the backend directory).

Configure the values in a local secret manager or ephemeral shell, then run:

```bash
cd backend
npm run evidence:smoke
npm run evidence:smoke -- --write-evidence

# Or run the fast end-to-end smoke test with negative verify check:
npm run smoke:testnet
# With live on-chain Testnet submission:
SMOKE_API_URL=https://.../api SMOKE_PAYER_SECRET=S... npm run smoke:testnet
```

The script is Testnet-only and never calls Friendbot. Fund the two distinct
accounts manually, keep the payer secret out of shell history and git, and
rotate it after the evidence run if it is a disposable account. Generated
artifacts are ignored by git.

The JSON artifact must contain:

- [ ] API, health, readiness, frontend, source revision, network, and capture time
- [ ] Invoice ID, exact XLM amount, memo, and seller/payer public keys
- [ ] 64-character transaction hash and Testnet Stellar Expert URL
- [ ] `createdPending`, `paymentSubmitted`, `verifiedPaid`, and `rereadPaid` checks
- [ ] `simulationDisabled: true` and final status `PAID`
- [ ] no payer secret, auth token, cookie, or secret key

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
