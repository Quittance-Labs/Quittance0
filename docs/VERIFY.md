# Payment verification

Every verify path — the MVP `/api/invoices/:id/verify` route, the Postgres
invoice controller, and `stellar.service` — routes through
`backend/src/services/payment-verification.ts`, so the checks and their
rejection codes stay identical everywhere.

The module is pure: callers fetch the transaction and its operations from
Horizon and hand them in.

## Order of checks

Checks run in a fixed order so every caller reports the same *first* failure:

1. **Transaction hash** — 64 hexadecimal characters, rejected before spending a
   Horizon round trip (`MISSING_TX_HASH`, `INVALID_TX_HASH`)
2. **Network** — a testnet payment cannot settle a pubnet invoice
   (`NETWORK_MISMATCH`)
3. **Payment operation** — the transaction must contain one
   (`NO_PAYMENT_OPERATION`)
4. **Memo** — must equal the invoice memo (`MEMO_MISMATCH`)
5. **Destination** — must be the seller's account (`DESTINATION_MISMATCH`)
6. **Amount** — compared at Stellar's 7-decimal precision (`AMOUNT_MISMATCH`)
7. **Asset** — code *and* issuer (`ASSET_MISMATCH`)

## Asset matching

This is the check that most often looks simpler than it is. A Stellar asset is
the pair `(code, issuer)` — see [ASSETS.md](./ASSETS.md) — so the codes matching
proves nothing on its own.

Both sides are resolved to an identity and compared:

| Invoice | Payment | Result |
| --- | --- | --- |
| native `XLM` | `asset_type: native` | **settles** |
| native `XLM` | credit asset coded `XLM` | `ASSET_MISMATCH` |
| `USDC` from issuer A | `USDC` from issuer A | **settles** |
| `USDC` from issuer A | `USDC` from issuer B | `ASSET_MISMATCH` |
| `USDC` from issuer A | `asset_type: native` | `ASSET_MISMATCH` |
| `USDC` with no issuer | anything | `ASSET_MISMATCH` |

Two of those rows are the reason this exists:

- **A credit asset coded `XLM` must never settle a native invoice.** Nothing
  stops someone issuing an asset whose code is the three characters `XLM`. If
  matching compared codes, that worthless token would mark the invoice `PAID`
  and the seller would hold nothing of value. The *type* decides, not the code.
- **An unpinned invoice settles with nothing.** A credit invoice that records
  no issuer names an asset nobody pinned, and an asset nobody pinned is not one
  anyone agreed to accept. It fails closed rather than matching any token that
  happens to share the code. Invoice creation rejects this case up front, so it
  should be unreachable — the check is the second line.

## Rejection codes

Every code has one user-facing message, defined once in
`VERIFICATION_MESSAGES` and mirrored in `frontend/lib/verification.js`.

## Tests

```bash
cd backend && npm test
```

- `tests/asset-helpers.test.ts` — asset identity and matching, including the
  fake-`XLM` and unpinned cases
- `tests/payment-verification.test.ts` — the full check order and every
  rejection
- `tests/invoice-payment-loop.test.ts` — create → pay → verify → `PAID` against
  the real Express app with a stubbed Horizon
