# Terminal-settlement integration — October 4, 2026

This report supplements the existing PR #563 / issue #558 contribution. It does not claim that all acceptance criteria are complete.

## Current upstream integration

Commit `6382fb59001008f27e43fd96ecdb3b9b756610b5` merges original contribution `04726ebd2ddb99a8cc9bb40c39e3dae1c5dd0cbe` with upstream `282c75ad933651a93b89a8412ab649b48714c739`, without rewriting either history. The resulting source tree is `4edbd31b3357dda6ebd7a1d901f51f19b5ff252d`.

Four conflicts were resolved in the shared handlers, memory service, Postgres service and cancellation/payment race suite. Cancellation retains the contribution's typed `409` loser responses, current status and already-recorded payment hash. The newer upstream lifecycle checks remain on the payment path. Missing-invoice cancellation keeps upstream's `404`; body-only wallet proof and both stores' payment-claim behavior are preserved. The new upstream lifecycle suite now asserts those exact cancellation responses and the retained hash instead of expecting the superseded generic response. Upstream payment-link artifacts, frontend changes and privacy-safe operational logging are retained.

## Executed scope

[Run 37191747168](https://github.com/woahwhattheheck/Quittance0/actions/runs/37191747168), Node `24.21.0`, completed successfully on the exact merge above:

```sh
npm --prefix backend ci --no-audit --no-fund
npm --prefix backend run typecheck
cd backend
node --import tsx --test tests/invoice-terminal-settlement.test.ts tests/invoice-state-machine.test.ts tests/invoice-cancel-payment-race.test.ts
```

Backend typecheck passed. The selected contracts passed **41 tests in 10 suites**, with no failures, skips or cancellations. The tracked-source diff after execution was empty. This was not a full frontend/backend suite, a real Postgres concurrency run, a deployment or a live payment.

[Artifact 11298848772](https://github.com/woahwhattheheck/Quittance0/actions/runs/37191747168/artifacts/11298848772) retains the command output, exact source identities and diff. ZIP SHA-256: `1a61238d8cf756c0cd57748570a28e26afc6ff4521e207c657eef26259de3e0c`. The temporary assembly/check workflow is not part of this contribution.

## Remaining policy decision

Issue #558 says that `CANCELLED` must never become `PAID`. The existing `LATE_PAYMENT_POLICY.md`, issue #507 and upstream lifecycle implementation permit an exact ledger payment to settle a cancelled invoice, retaining its cancellation history and late-payment classification. This integration preserves that existing policy; it does **not** resolve the contradiction or claim the stricter finality criterion is met. The maintainer must decide which behavior governs before this contribution can claim to close #558.
