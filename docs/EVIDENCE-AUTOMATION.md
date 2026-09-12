# Evidence automation for SCF reviewers

Status: proposal (issue #386). It pins the script interface, the env vars and the
artifact checklist so the automation can be written against `EVIDENCE.md` rather
than replacing it.

## Goal

Turn the manual "create an invoice, pay it, copy the hash, edit `EVIDENCE.md`"
loop into one command that produces the reviewer artifact set against a deployed
API, without adding a second setup guide.

## Script interface

```bash
# one command, runnable from a clean checkout against a deployed API
npm run evidence:smoke -- --api https://<service>.onrender.com/api \
                         --frontend https://<project>.vercel.app \
                         --network testnet \
                         --out evidence/
```

- Exit code 0 only when every artifact is captured; non-zero with the failing
  step named on stderr otherwise.
- `--api` is the only required argument, mirroring the existing
  `scripts/deploy-smoke.mjs` convention (`DEPLOY_API_URL` or `argv[2]`), so one
  habit covers both scripts.
- `--write` is opt-in and performs the `EVIDENCE.md` slot filling described
  below. Without it the script is read-only and prints the checklist, which keeps
  the default run safe on a shared machine.
- `--dry-run` stops after invoice creation, for debugging the API without
  spending testnet funds.

## Required environment

| Variable | Required | Purpose | Handling |
|---|---|---|---|
| `EVIDENCE_SELLER_SECRET` | yes | seller key that creates the invoice | env only; never written to disk, never echoed |
| `EVIDENCE_PAYER_SECRET` | yes | second funded testnet account that pays | env only; must differ from the seller key |
| `EVIDENCE_NETWORK` | yes | `testnet` or `public` | `public` is refused by the script |
| `EVIDENCE_API_URL` | yes | deployed API base, e.g. `https://x.onrender.com/api` | same shape as `DEPLOY_API_URL` |
| `EVIDENCE_FRONTEND_URL` | no | fills the demo URL slot | only used with `--write` |
| `EVIDENCE_SOURCE_REVISION` | no | commit SHA deployed | defaults to `git rev-parse HEAD` |
| `EVIDENCE_OUT_DIR` | no | artifact directory | defaults to `evidence/`, which is git-ignored |

Secrets stay in the environment. The script must refuse to run if
`EVIDENCE_SELLER_SECRET` and `EVIDENCE_PAYER_SECRET` are equal, because a
self-payment produces a memo-matching transaction that proves nothing about the
payer path. Testnet keys can be generated with the existing tooling; the script
prints the public keys it will use before doing anything, so a reviewer can
confirm the accounts match the evidence.

## Flow

1. `GET /health` and `GET /ready` → liveness and readiness slots, with HTTP
   status and body captured.
2. `POST /invoices` as the seller → invoice id, payment link, memo, expiry.
3. Pay the invoice from the payer account on testnet.
4. `POST /invoices/:id/verify` with the tx hash → expect `PAID` and the
   verification result.
5. Download the proof the frontend offers and store it as an artifact.
6. Write `evidence/summary.json` with every captured slot, then (only with
   `--write`) fill the corresponding `REQUIRED` slots in `EVIDENCE.md`.

## Artifact checklist

Mirrors the slots `EVIDENCE.md` already defines, so nothing new has to be
explained to a reviewer:

| EVIDENCE.md slot | Produced by |
|---|---|
| Frontend URL | `--frontend` argument |
| API liveness + readiness | step 1 (status code and JSON body) |
| Network | `EVIDENCE_NETWORK`, asserted `testnet` |
| Source revision | `EVIDENCE_SOURCE_REVISION` or `git rev-parse HEAD` |
| Captured at (UTC) | timestamp of step 4 |
| Testnet transaction row | step 3-4: memo, amount, asset, 64-char hash, `stellar.expert` URL |
| Proof download | step 5 artifact path |

`--write` replaces only `REQUIRED`-prefixed cells and never rewrites prose. If any
required slot remains `REQUIRED` afterwards the script exits non-zero, matching the
"do not submit the pack while a required slot remains" rule at the top of
`EVIDENCE.md`.

## Failure modes and how the script should behave

| Failure | Behaviour |
|---|---|
| Invoice store cleared by a restart (in-memory MVP) | fail with "invoice disappeared; re-run against a warm instance" rather than retrying silently |
| Memo mismatch on verify | surface the rejection code from `docs/VERIFY.md`, leave the artifact set incomplete |
| Insufficient testnet balance | print the payer public key and the funding instruction already in `EVIDENCE.md` |
| Rate limited by the API | honour `Retry-After` once, then fail loudly |
| `--network public` | refuse to start |

## Non-goals

Mainnet automation, faucet abuse (the script funds one account per run and does
not loop), and replacing the human demo recording. The script also does not
assert that the demo *looks* right; a reviewer still watches the flow.

## Test plan

- unit: slot replacement touches only `REQUIRED` cells and is idempotent
- unit: equal seller/payer secrets are refused before any network call
- unit: `--network public` exits non-zero with no artifacts written
- integration: against a locally started API with a stubbed Horizon, the script
  produces `summary.json` with every slot populated
- regression: after `--write`, a second `--write` run changes nothing
