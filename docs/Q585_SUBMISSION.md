# Quittance #585 submission

Target repository: `Quittance-Labs/Quittance0`  
Base branch: `main`  
Head: `woahwhattheheck:feat/q585-monitor-payment-parity-ledger0938`  
Title: **Align monitor and wallet with path payments and pending claimable balances**  
Implementation commit: `2704b3ed3878cafcee38a526b7111d7904eed7a6`

## Pull request body

Closes #585.

The backend monitor previously filtered out path payments and rebuilt each observed payment as one synthetic operation. That could disagree with manual verification, lose the delivered credit asset, and incorrectly accept the first payment in an ambiguous transaction. Claimable balances also never reached the seller's event feed.

## Changes

- Poll the account operations feed while retaining existing operation paging tokens. Normalize ordinary, strict-send and strict-receive payments using destination amount/code/issuer.
- Reuse the observed transaction envelope and fetch its complete operation list once per candidate transaction. Run the same `verifyHorizonPayment` as POST verify; preserve multi-operation selection, ledger settlement time and per-record checkpoints.
- Observe claimable-balance creation for the seller, resolve its immutable balance ID from creation effects, and log `CLAIMABLE_BALANCE_RECEIVED` with amount, asset and predicate. The invoice stays pending. Memory storage and a PostgreSQL partial unique index deduplicate cursor replay.
- Give account creation/merge an explicit shared rejection code. Show claim information in the seller feed; accept path payments in the wallet stream with one received notification per operation.
- Preserve existing monitor fixtures through a test-only full-transaction source helper and document the actual Horizon field mapping.

## Validation

Both packages installed from their existing lockfiles with `npm ci`; neither lockfile changed.

- Backend: 103 focused verifier/monitor/server tests passed, plus 22 existing cancellation/attribution tests passed (125 total; no skips).
- Frontend: 16 payment-stream, event-rendering and rejection-label tests passed with locked dependencies.
- Backend and frontend TypeScript checks passed.
- The new acceptance suite drives the actual Horizon service mapping, monitor, memory storage and HTTP POST verify route. It covers every existing USDC fixture, more than ten operations, ambiguous seller payments, both unsupported operation types, claimable replay/restart and missing creation effects.

The focused commands and fixture interpretation are in [PAYMENT_MONITOR.md](docs/PAYMENT_MONITOR.md).

## Public Testnet evidence

The committed [receipt bundle](backend/tests/fixtures/monitor-testnet-receipts.json) retains 15 exact public HTTP response bodies with URLs, capture timestamps, byte counts and SHA-256 hashes. It includes real strict-send, strict-receive, native claimable and USDC claimable transactions. The tests consume unchanged strict-receive and memo-bearing claimable envelopes against constructed test invoices.

The strict-send capture has **no memo**. Its unchanged destination mapping is tested separately from an explicitly synthetic memo-bearing derivative. The legacy path rows also remain labeled synthetic. No live Quittance invoice or newly submitted transaction is asserted.

## PostgreSQL rollout and acceptance

Apply `db/schema.sql` before enabling this monitor so `payment_events_claimable_balance_unique` exists. The `claimable-event-postgres.integration.test.ts` acceptance checks concurrent writers, schema replay and a fresh connection in its own schema when `DATABASE_URL` is provided.

This check passed on implementation head `66f18e99a62c8373b5e487100d99f49368e2576f` in [native run 37204455112, job 111442631510](https://github.com/woahwhattheheck/bounty-concierge/actions/runs/37204455112/job/111442631510), using Node 24.21.0, npm 11.19.0 and PostgreSQL 16.15. Result: **1 test passed, 0 failed, 0 skipped**; 93.757396 ms test time, 413.141959 ms total. Command, from `backend` with the isolated runner database configured:

```sh
node --import tsx --test tests/claimable-event-postgres.integration.test.ts
```

The combined workflow subsequently failed in a separate Q584 Horizon 404 fixture. The Q585 PostgreSQL acceptance step itself succeeded.
