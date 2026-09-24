# Payment verification

Every verify path — the MVP `/api/invoices/:id/verify` route, the Postgres
invoice controller, and `stellar.service` — routes through
`backend/src/services/payment-verification.ts`, so the checks and their
rejection codes stay identical everywhere.

The module is pure: callers fetch the transaction and its operations from
Horizon and hand them in. All Horizon traffic goes through
`backend/src/utils/horizon-client.ts`, which bounds each call with a
timeout, retries 429/5xx honoring `Retry-After`, and shares one concurrency
budget between verify and the monitor. When Horizon stays unreachable the
caller reports `VERIFY_UNAVAILABLE` (503) rather than
`TRANSACTION_NOT_FOUND` — an outage must never read as a rejection, and it
is never written to the verify cache. Timeout, HTTP 429, and connection
failures are classified by `classifyHorizonFailure` in
`backend/src/utils/horizon-client.ts` before verify or the monitor compare
memo, destination, or amount. A previously cached `VERIFY_UNAVAILABLE` is
dropped on read. The pay page shows one retryable alert using the canonical
message (aligned with the monitor's `BACKOFF_MAX_MS` / 30s ceiling); the
per-invoice verify rate limit still returns `VERIFY_RATE_LIMIT_EXCEEDED`
when the payer — not Horizon — is flooding verify.

## Order of checks

Checks run in a fixed order so every caller reports the same *first* failure:

1. **Transaction hash** — 64 hexadecimal characters, rejected before spending a
   Horizon round trip (`MISSING_TX_HASH`, `INVALID_TX_HASH`)
2. **Network** — a testnet payment cannot settle a pubnet invoice
   (`NETWORK_MISMATCH`)
3. **Payment operation** — the transaction's operations are walked for
   payment-delivering ops (`payment`, `path_payment_strict_receive`,
   `path_payment_strict_send`); non-payment ops like `change_trust` are
   ignored. The transaction must contain exactly one payment to the
   invoice's destination: zero payments anywhere is
   `NO_PAYMENT_OPERATION`, and two or more payments to the seller is
   `AMBIGUOUS_PAYMENT_OPERATION` — verification never sums them or picks
   between them
4. **Memo** — the transaction must carry a *text* memo (or none): `hash`,
   `id` and `return` memos are rejected outright as `MEMO_TYPE_MISMATCH`
   rather than coerced into the comparison, and a text memo must then equal
   the invoice memo (`MEMO_MISMATCH`)
5. **Destination** — must be the seller's account (`DESTINATION_MISMATCH`).
   A muxed `M...` address counts when its underlying account is the seller's
   `G...` key; a muxed address of a different account does not.
6. **Amount** — compared at Stellar's 7-decimal precision with no tolerance:
   less than the invoice is `AMOUNT_TOO_LOW`, more is `AMOUNT_TOO_HIGH`, and
   `AMOUNT_MISMATCH` is reserved for an amount that cannot be compared at all
   (`abc`, an empty string, a missing operation field)
7. **Asset** — code *and* issuer (`ASSET_MISMATCH`)

## Destination matching and muxed accounts

Wallets may pay a muxed `M...` account whose underlying `G` account is the
seller. Destination matching follows Stellar's muxed-account rules rather than
comparing strings:

| Payment `to` | Invoice seller | Result |
| --- | --- | --- |
| `G...` equal to the seller | `G...` | **settles** |
| `M...` whose base account is the seller | `G...` | **settles**; the muxed id is recorded on the `PAYMENT_CONFIRMED` event |
| `M...` of a different base account | `G...` | `DESTINATION_MISMATCH` |
| malformed `M...` or any other string | `G...` | `DESTINATION_MISMATCH` |

Decoding goes through the SDK (`MuxedAccount.fromAddress`), never string
slicing — a malformed destination fails closed instead of being coerced into a
`G` key. The seller identity stored on the invoice, shown on the proof, and
used for dashboard scoping stays the plain `G...` account throughout.

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

## Tests

```bash
cd backend && npm test
```

- `tests/asset-helpers.test.ts` — asset identity and matching, including the
  fake-`XLM` and unpinned cases
- `tests/payment-verification.test.ts` — the full check order and every
  rejection
- `tests/invoice-payment-loop.test.ts` — create → pay → verify → `PAID` against
  the real Express app with a stubbed Horizon, including a concurrent
  double-POST of one verification
- `tests/payment-attribution.test.ts` — hash-to-invoice claims, memo
  uniqueness, and the one-transaction-one-invoice rule
- `tests/horizon-client.test.ts` — named Horizon failure classes (429,
  timeout, connection) and the shared retry budget
- `tests/verify-cache.test.ts` — VERIFY_UNAVAILABLE is never stored and a
  previously cached entry is dropped on get

Which invoice a transaction settles, and what a second caller sees, is covered
separately in [VERIFY-IDEMPOTENCY.md](./VERIFY-IDEMPOTENCY.md).
