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
6. **Amount** — compared at Stellar's 7-decimal precision with no tolerance:
   less than the invoice is `AMOUNT_TOO_LOW`, more is `AMOUNT_TOO_HIGH`, and
   `AMOUNT_MISMATCH` is reserved for an amount that cannot be compared at all
   (`abc`, an empty string, a missing operation field)
7. **Asset** — code *and* issuer (`ASSET_MISMATCH`)

## Multi-operation transactions and operation matching

Horizon transactions frequently bundle multiple operations in a single envelope:
a `change_trust` establishing an asset trustline followed by payment, fee-bump inner
transactions, or auxiliary payments.

The verification pipeline processes multi-operation envelopes under the following rules:

1. **Non-payment operations are ignored**: Operations such as `change_trust`,
   `manage_data`, or `create_account` are bypassed. Only payment-delivering
   operations (`payment`, `path_payment_strict_receive`, `path_payment_strict_send`)
   are evaluated.
2. **Unique matching payment op required**: The walker searches for a payment
   operation that uniquely matches the invoice destination, exact amount, and
   asset code/issuer.
3. **No aggregation of partial payments**: Multiple partial payments are never summed
   to satisfy an invoice amount. Each payment op is evaluated independently.
4. **Fail closed on ambiguity**:
   - If **more than one** payment operation matches destination, amount, and asset,
     the transaction fails closed with `MULTIPLE_PAYMENT_OPERATIONS` and does not settle.
   - If **zero** payment operations match all three criteria, the engine diagnoses the
     first failure according to the canonical order of checks (`DESTINATION_MISMATCH`,
     `AMOUNT_TOO_LOW`, `AMOUNT_TOO_HIGH`, `AMOUNT_MISMATCH`, or `ASSET_MISMATCH`).
   - If a transaction contains payment to an unrelated destination alongside the
     seller payment, the unrelated payment is ignored and the valid matching payment settles.

## Amount policy

An invoice settles on the exact amount, not on at-least. A payment one stroop
short is rejected as `AMOUNT_TOO_LOW` and the invoice stays `PENDING`: the
money is not lost, but it does not settle the invoice either. A payment one
stroop over is rejected as `AMOUNT_TOO_HIGH`: the funds still reach the
seller, but the invoice does not transition on them, so a client that
overpays cannot silently turn a 50 USDC invoice into a 100 USDC one. Both
outcomes are recorded in the payment-event log for reconciliation
(see [LATE_PAYMENT_POLICY.md](./LATE_PAYMENT_POLICY.md)).

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

When a transaction contains multiple matching payment operations that make settlement
ambiguous, `MULTIPLE_PAYMENT_OPERATIONS` is returned.

## Tests

```bash
cd backend && npm test
```

- `tests/asset-helpers.test.ts` — asset identity and matching, including the
  fake-`XLM` and unpinned cases
- `tests/payment-verification.test.ts` — the full check order and every
  rejection
- `tests/multi-operation-payment.test.ts` — multi-operation scenarios: trustline + pay,
  multiple matching payments, payment order, and non-payment filtering
- `tests/invoice-payment-loop.test.ts` — create → pay → verify → `PAID` against
  the real Express app with a stubbed Horizon, including a concurrent
  double-POST of one verification
- `tests/payment-attribution.test.ts` — hash-to-invoice claims, memo
  uniqueness, and the one-transaction-one-invoice rule

Which invoice a transaction settles, and what a second caller sees, is covered
separately in [VERIFY-IDEMPOTENCY.md](./VERIFY-IDEMPOTENCY.md).
