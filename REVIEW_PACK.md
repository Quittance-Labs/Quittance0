# Quittance — offline review pack for external AI

Use this document when an AI cannot clone GitHub. Paste this file + the prompt at the bottom into the other chat.

Repo: https://github.com/CemAyyildiz/Quittance  
Stack: Next.js 14 frontend + Express/TS MVP backend + Stellar Horizon (no smart contracts in MVP).

---

## Product lock

- Quittance = invoice → Stellar pay → Horizon verify → download/email proof.
- Not SustainOpen/Stellink payment-link/escrow. Do not propose marketplace/Upwork.
- Identity = Freighter only. Email = optional mailto delivery. No Google gate for create/pay.
- Sharp user: freelancer → client, XLM first / USDC later.
- Demo path: `backend` `npm run start:mvp` / `dev:mvp` (in-memory). Full Postgres `server.ts` exists but is secondary and known out of sync (static env seller).

## Shipped status (owner claim, Jul 2026)

| Item | Claimed status |
|------|----------------|
| Wallet-only create/pay | Done |
| Optional client email + mailto send | Done |
| Horizon verify (memo, amount, destination, asset) | Done on MVP |
| Dashboard scoped by `sellerPublicKey` | Done |
| Download Proof primary CTA | Done |
| Simulate UI removed; API gated by `ALLOW_SIMULATE` | Done |
| Landing redesign (no Stellink watermark JPG bg) | Done |
| Payment loading toast dismiss bug | Fixed |
| Public deploy + EVIDENCE filled | Not done |
| Postgres / SMTP / analytics / Sentry | Not done |

## Key paths

```
README.md, PLAN.md, ROADMAP.md, EVIDENCE.md
backend/src/server-mvp.ts          # demo API
backend/src/services/stellar.service.ts
backend/src/services/invoice-memory.service.ts
backend/src/storage/memory-storage.ts
frontend/app/page.tsx              # landing
frontend/app/pay/[id]/page.tsx
frontend/app/dashboard/page.tsx
frontend/components/InvoiceForm.tsx
frontend/components/PaymentButton.tsx
frontend/components/PaymentReceipt.tsx
frontend/lib/api.ts, stellar.ts, export.ts
```

## Architecture (MVP)

```
Browser (Next.js + Freighter)
  → POST /api/invoices { amount, sellerPublicKey, optional customerEmail, ... }
  → share /pay/:id + QR
  → Freighter payment with invoice memo
  → POST /api/invoices/:id/verify { txHash }
       → Horizon load tx + payment op
       → check memo, amount, destination (== sellerPublicKey), asset
  → PAID → Download Proof (client PDF) / Email Proof (mailto)
Dashboard: GET /api/invoices?sellerPublicKey=... and stats same filter.
Storage: in-memory Map; restart clears data.
```

## Known gaps / risks (pre-reported; verify and extend)

1. No public URL yet — production/demo incomplete.
2. In-memory = not production persistence.
3. Full `server.ts` + PG still uses env `SELLER_PUBLIC_KEY` in places — do not mix with MVP demo.
4. `GoogleLogin.tsx` / `lib/auth.ts` mock may still exist as dead code.
5. `Quittance.jpg` historically contained Stellink branding; landing should not use it as watermark (text brand preferred).
6. USDC needs trustlines — XLM is the reliable demo path.
7. Client PDF is print-to-PDF HTML, not server PDF.
8. No Sentry/analytics/feedback loop yet (Journey Mastery gaps).
9. Redis/Bull deps largely unused on MVP path.
10. Backend `tsc` may still have pre-existing stellar.service typing noise.

## Goals of review

Owner wants blunt senior review for:
- Stellar Startup Track idea alignment (Payments use case)
- Journey Mastery / production-MVP gaps
- Shipping online demo + real users next
- Design quality after landing redesign
- Do NOT recommend Google login gate or marketplace pivot

## Prompt for the reviewing AI

Review Quittance using ONLY the review pack above (and any extra file excerpts I paste). You cannot access GitHub — do not refuse; work from this pack.

Deliver:

1. Executive verdict (5–8 sentences)
2. Architecture review (verify path, wallet scoping, privacy)
3. Product–code alignment vs locked decisions
4. Critical bugs/risks P0/P1/P2 (infer from pack + any pasted code; mark speculation)
5. Production readiness score 1–10
6. UX/design concrete fixes
7. Prioritized next 10 actions for public demo + real users + Mastery (analytics/errors/feedback), without marketplace scope creep

Rules: blunt, English, no fluff, no inventing a different product.
