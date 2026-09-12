# Payment attribution: one transaction settles one invoice

[VERIFY.md](./VERIFY.md) covers the checks a payment has to pass. This covers
what happens after they pass: which invoice a transaction settles, what a second
caller sees, and what stops one on-chain payment from being counted twice.
Issue #379.

## What can arrive twice

Three callers reach the attribution step:

- the pay page posting `/api/invoices/:id/verify`
- the payment monitor, attributing on a stream tick
- a client retrying after a timeout, with the same transaction hash

The verify path reads the invoice status, **awaits Horizon**, and only then
marks the invoice paid. Everything that can happen between those two steps
happens while the invoice still reads `PENDING`.

## Two hazards, two different answers

**Same invoice, twice.** Already covered before this change: after the first
caller commits, the second is answered `400 INVOICE_ALREADY_PAID`, whether it
races (status read before the commit) or arrives later (status read after it).

**Same transaction, two invoices.** One payment marking two invoices `PAID`.
This is impossible while invoice memos are unique, because the memo is what a
transaction is matched against and a transaction carries exactly one memo — so
a payment that satisfies invoice A cannot satisfy invoice B. Which means the
whole guarantee rests on an invariant, and this change is about making that
invariant true rather than assumed:

| Defense | What it proves | Where it lives |
| --- | --- | --- |
| Memo equality | the transaction carries *this* invoice's memo | `services/payment-verification.ts` (unchanged) |
| Memo uniqueness at creation | two invoices never hold the same memo | `storage/memory-storage.ts` (new) |
| Hash → invoice claim | a hash that settled one invoice cannot settle another | `domain/payment-attribution.ts` (new) |

The third is a backstop, not the primary check. It exists so that the failure
mode of a memo collision is a refusal, rather than a second invoice being paid
with someone else's money.

## The claim is one check-and-set

`PaymentClaimIndex.claim()` reads the existing claim and records a new one in
the same synchronous step, and records it **only** when the caller is allowed to
apply:

| Prior claim on the hash | Decision | What the caller does |
| --- | --- | --- |
| none | `apply` | mark the invoice paid |
| this invoice | `replay` | fall through to the existing already-paid contract |
| another invoice | `conflict` | refuse: `409 TX_HASH_ALREADY_USED` |

There is no `await` between the read and the write, so the first caller to
arrive records the claim and every later caller observes it. A refused claim
does not capture the hash, so losing a race does not take the transaction away
from the invoice that was supposed to have it.

## State machine, concurrent verify of one invoice

| Order | Response |
| --- | --- |
| First caller | `200`, invoice `PAID`, `paymentTxHash` recorded |
| Second caller, after the first committed | `400 INVOICE_ALREADY_PAID` |
| Second caller, racing the first | `400 INVOICE_ALREADY_PAID` |

The third row is the one that matters, and it is pinned by
`tests/invoice-payment-loop.test.ts` ("marks the invoice PAID exactly once when
two verifications race"): two requests in flight at once, and the assertion is
that the responses are exactly `[200, 400]` whichever order they land in, with
one recorded transaction hash. The re-read in the verify handler is what produced
that answer before this change; the claim makes it structural rather than
incidental.

## Rejection codes

One code is added. Nothing is renamed, reordered or reworded, and no existing
code changes what it means.

| Code | HTTP | Message |
| --- | --- | --- |
| `TX_HASH_ALREADY_USED` | 409 | Transaction already settled another invoice |

Compatibility notes:

- 409 rather than 400: the request is well formed, and it is the server's
  recorded state that refuses it.
- No client has to handle it to keep working. It fires only for a transaction
  that already settled another invoice, which needs a memo collision to reach —
  and creation now refuses to produce one.
- `frontend/lib/verification.js` keeps its mirror of `VERIFICATION_MESSAGES`
  in step, which is what that file's header comment asks for.

## Memo uniqueness

`generateInvoiceMemo()` produces `INV-<base36 ms>-<8 random chars>`, and until
this change nothing checked whether the result was already taken. A collision
was not just a theoretical double-payment risk: `MemoryStorage` keys its memo
index by memo, so the second invoice **overwrote** the first one's entry and the
first became unreachable by the lookup the payment monitor uses. Run against
`main`:

```text
created: invoice-1 and invoice-2 both with memo INV-SAME-MEMO
lookup by memo resolves to: invoice-2
invoice-1 still present by id: invoice-1
```

Two changes:

- `MemoryStorage.createInvoice` throws `MemoCollisionError` instead of
  overwriting, and `hasMemo()` answers the question without the expiry sweep
  `getInvoiceByMemo()` runs.
- `InvoiceMemoryService.createInvoice` draws a fresh memo when the first draw is
  taken, up to `MEMO_DRAW_ATTEMPTS` (3), then throws. The generator is
  injectable, which is how the retry is tested without waiting for a real
  collision.

## Audit fields

The invoice already carries what attribution needs: `paidAt`,
`paymentTxHash` and `payerPublicKey`. The claim adds `claimedAt` — the time the
hash was first seen, which is not always the same instant as `paidAt`. No new
column is proposed for the MVP: `paidAt` and `claimedAt` are set from the same
call, so a separate `verified_at` column would duplicate it. If a first-seen
time ever needs to survive a restart independently of `paidAt`, that is the
column to add, populated from the claim.

## Uniqueness: what this does now, and what the database should do next

**Memory MVP (this PR).** Both rules live in the process. Stated plainly as a
ceiling: the claim index is lost on restart and is not shared between instances,
so a second instance would not see another instance's claims. That is correct
for the single-instance memory backend and is the reason the durable form
belongs in Postgres.

**Postgres (recommended, not in this PR).** `db/schema.sql` already indexes
memo, but not uniquely, and `payment_tx_hash` carries no constraint at all:

```sql
-- replaces idx_invoices_memo, which becomes redundant
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_memo ON invoices (memo);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_payment_tx_hash
  ON invoices (payment_tx_hash)
  WHERE payment_tx_hash IS NOT NULL;
```

Why it is not in this PR: the Postgres path cannot be exercised by this
repository's default test run (`npm run test:pg` needs a live database), and an
unverified migration is worse than a documented one. Until it lands, the two
backends differ on this rule — worth saying out loud rather than leaving to be
discovered.

## Coverage

```bash
cd backend && node --import tsx --test tests/payment-attribution.test.ts
cd backend && node --import tsx --test tests/invoice-payment-loop.test.ts
```

- `tests/payment-attribution.test.ts` (new, 12 tests) — apply/replay/conflict
  decisions, a refused claim not capturing the hash, one hash settling one
  invoice, the hash staying free when an earlier guard rejects the invoice,
  and memo uniqueness including the retry and its exhaustion.
- `tests/invoice-payment-loop.test.ts` — the concurrent double-POST and a
  reused hash against a second invoice.

**What the HTTP route cannot reach, and why it is tested elsewhere.** The
conflict path needs both invoices to hold the same memo. Over HTTP the memo
check fails first — a transaction has one memo — so the reused-hash test on that
route asserts `400 MEMO_MISMATCH` and the invoice staying `PENDING`, while the
conflict itself is exercised at the storage level. That is the honest shape of
the coverage, not a shortcut.

**Pre-existing failures, not from this change.** `tests/invoice-handlers.test.ts`
fails on `main` with 36 failures: it builds seller keys as `'G' + 'A'.repeat(55)`,
which are not valid StrKeys, and `formatQrPaymentPayload` now rejects them, so
invoice creation returns 400 before any assertion about verification runs. The
same 36 failures were reproduced on an untouched `origin/main` checkout. Fixing
those fixtures is its own change, so it is not bundled here.

## Files

| File | Change |
| --- | --- |
| `backend/src/domain/payment-attribution.ts` | new: claim index, decisions, errors |
| `backend/src/storage/memory-storage.ts` | memo guard, claim on `markAsPaid`, read-only lookups |
| `backend/src/services/invoice-memory.service.ts` | memo re-draw, injectable generator |
| `backend/src/services/payment-verification.ts` | `TX_HASH_ALREADY_USED` + its message |
| `backend/src/routes/invoice.handlers.ts` | conflict → `409` with the code |
| `frontend/lib/verification.js` | mirror of the code list kept in step |
| `backend/tests/payment-attribution.test.ts` | new unit coverage |
| `backend/tests/invoice-payment-loop.test.ts` | two new integration tests; distinct hash per verification |

