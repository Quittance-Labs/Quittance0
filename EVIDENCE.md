# Quittance — Demo & Testnet Evidence

Reviewer one-pager. Fill in the blanks after Phase D4–D5 (deploy + real payments).

---

## Public demo

| Item | Value |
|------|--------|
| Frontend | `_TBD — e.g. https://quittance.vercel.app_` |
| API health | `_TBD — e.g. https://quittance-api.onrender.com/api/health_` |
| Network | Stellar **TESTNET** |

**How to try (≤ 3 min)**

1. Open the frontend URL  
2. Connect Freighter (Testnet) and fund the account if needed  
3. Create an invoice → copy payment link  
4. Pay with Freighter on `/pay/[id]`  
5. Confirm **PAID** → **Download Proof**  

**Limits:** MVP API is in-memory. Process restarts clear invoices. Keep demos short.

---

## Testnet transactions

| # | Amount | Asset | Memo | Tx hash | Explorer |
|---|--------|-------|------|---------|----------|
| 1 | _TBD_ | XLM | _TBD_ | `_paste 64-char hash_` | [link](https://stellar.expert/explorer/testnet/tx/_hash_) |
| 2 | _TBD_ | XLM | _TBD_ | `_optional second_` | |

After a successful pay, copy the hash from the receipt or Freighter history.

---

## Screen recording

| Item | Value |
|------|--------|
| File / link | `_TBD — Loom, Drive, or repo release asset_` |
| Length | Target ≤ 3 minutes |
| Script | Create → share/pay → verify → Download Proof → dashboard |

---

## Tech note (short)

- **Product:** Freelancer invoice → Stellar pay → payment proof (quittance)  
- **Identity:** Freighter wallet only (no Google login gate)  
- **Email:** Optional delivery (`mailto:` for Send invoice / Email proof)  
- **Verify:** `POST /api/invoices/:id/verify` loads the tx from Horizon and checks memo, amount, destination, and asset  
- **Seller model:** Each invoice stores the creator’s `sellerPublicKey` (dynamic wallet)  
- **Storage (demo):** In-memory MVP (`npm run start:mvp`) — not Postgres yet  
- **Proof:** Browser PDF (“Download Proof”) + optional email  

Ship plan: [`PLAN.md`](./PLAN.md).

---

## Checklist before SCF / external review

- [ ] Frontend and API URLs filled above and reachable  
- [ ] At least one real testnet tx hash linked  
- [ ] Recording uploaded and linked  
- [ ] CORS: `FRONTEND_URL` on API matches the live frontend origin  
- [ ] `ALLOW_SIMULATE=false` on production API  
