# Abuse controls for the public pay and verify endpoints

Status: proposal (issue #383). Written against the code as it is today; the
ranking below is based on what is reachable, not on what is theoretically
possible.

## What the surface looks like today

| Fact | Evidence |
|---|---|
| No rate limiting anywhere in the backend | no `rate-limit` / `throttle` dependency or middleware matches anywhere under `backend/src` |
| Request bodies are parsed with the framework default (100 kB) | `express.json()` with no `limit` option in `backend/src/server-mvp.ts` and `server.ts` |
| The invoice surface is public | `backend/src/routes/invoice.routes.ts` mounts create, list, payment-info, cancel, verify and the dev-only simulate route |
| Cancellation accepts an optional claimed key | `cancelInvoice(id, sellerPublicKey?)` in `backend/src/storage/memory-storage.ts` skips the ownership check entirely when the key is absent (`if (sellerPublicKey && ...)`) |
| The seller key is not a secret | `GET /invoices/:id/payment-info` returns the destination the payer must pay, which is the seller's public key |
| Verification spends a Horizon round trip per call | `docs/VERIFY.md` step 1 note: the hash is validated *before* the round trip, so a malformed hash is cheap and a well-formed one is not |
| MVP storage is in-memory | `EVIDENCE.md`: a restart clears invoices |

## Ranked scenarios

Ordered by likelihood x impact, with the cheapest effective mitigation noted
per row. Rows 1 and 2 are correctness bugs, not volume problems — a rate limit
does not fix either, which is the single most important point in this document.

| # | Scenario | How it works here | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Unauthenticated cancellation** | `POST /invoices/:id/cancel` with an empty body: the ownership check is skipped when `sellerPublicKey` is omitted, so any pending invoice can be cancelled by anyone who knows its id | A payer can be turned away from a live invoice; the freelancer loses the sale | Require the key and verify a real signature over the invoice id; return 401 when it is absent |
| 2 | **Owner check is a claimed string** | Even with the key supplied, `invoice.sellerPublicKey !== sellerPublicKey` compares a value that `payment-info` already publishes | Same as row 1, once the attacker reads payment-info | Same fix: sign rather than claim |
| 3 | **Verification amplification** | Each `POST /invoices/:id/verify` with a well-formed hash costs one Horizon round trip; the endpoint is public and unauthenticated | One script can consume the MVP's Horizon budget and slow the demo for everyone | Per-IP token bucket, and cache the verified tx hash per invoice |
| 4 | **Invoice flood** | `POST /invoices` accepts an arbitrary seller key with no proof of control, so a script can fill the in-memory store | Memory growth, noisy listing, and a restart wipes legitimate invoices with the junk | Per-IP creation quota plus a global cap with 503 when full |
| 5 | **Cross-wallet enumeration** | `GET /invoices?wallet/sellerPublicKey=...` requires a key but the key is public, so one seller's invoice metadata can be listed by anyone | Metadata exposure (amounts, expiry, payer name/email is not listed) | Treat listing as authenticated; scope by signature |
| 6 | **Oversized bodies** | No explicit JSON limit, so the framework default applies and validation happens after parse | Cheap memory pressure per request | Set an explicit small `limit` and reject with 413 |
| 7 | **Dev-only route exposure** | `POST /invoices/:id/simulate-payment` already refuses to run when `NODE_ENV=production` | A misconfigured deployment could mark invoices PAID without a payment | Keep the guard and assert it in a test that fails if the default flips |
| 8 | **Faucet abuse** | The evidence flow funds testnet accounts | Not a service risk, but a reviewability one | Document the one-account-per-run assumption in the evidence automation design |

## Proposed limits and HTTP behaviour

Limits are per client IP, with the invoice id as a second key where it applies.
Numbers are sized for a demo, not a product: the MVP runs a single instance on a
free-tier host and its only real downstream is Horizon.

| Endpoint | Limit | Response when exceeded |
|---|---|---|
| `POST /invoices` | 10 / 10 min / IP, 5 / min / IP | 429 + `Retry-After` |
| `POST /invoices/:id/verify` | 30 / min / IP, 10 / min / invoice | 429 + `Retry-After` |
| `GET /invoices` | 60 / min / IP | 429 + `Retry-After` |
| `POST /invoices/:id/cancel` | 10 / min / IP; and 401 when no proof of ownership is supplied | 401 (auth) before 429 (volume) |
| any body over 16 kB | hard cap | 413 with a JSON error envelope |
| global invoice ceiling (in-memory MVP) | e.g. 5,000 invoices | 503 `INVOICE_STORE_FULL` with a `Retry-After` |
| Horizon-dependent paths under load | 1 in-flight verify per invoice | 429 `VERIFY_IN_PROGRESS` |

Every rejection uses the existing failure envelope so the frontend keeps one
error path, and each 429 carries `Retry-After` in seconds. The status codes
deliberately separate the three cases the frontend must render differently:
401 (you are not allowed), 429 (you are allowed, not now), 413/503 (the server
cannot take this).

## Closed demo versus public internet

**While the demo is closed** (URL unlisted, reviewers only, in-memory storage):

- Fix rows 1 and 2 first. They are ten lines of code and they are the difference
  between "the demo works" and "the demo can be sabotaged by a link".
- Add the explicit JSON body limit and the global invoice ceiling; both are
  one-line changes and they bound the blast radius of a script.
- Set the verify limiter per invoice rather than per IP: reviewers share an IP
  more often than attackers do.
- Skip WAF/edge configuration entirely. It is not worth the setup time at this
  stage, and the limits above already keep the demo responsive.

**Before public exposure**, add:

- Ownership proofs on create, cancel and list, so the API stops trusting keys
  that it publishes itself.
- Per-IP limits that distinguish authenticated from anonymous callers, with the
  anonymous tier an order of magnitude tighter.
- An abuse event stream: the `http.request`, `invoice.verify_rejected` and
  `payment.unmatched` events proposed in `docs/LOGGING.md` are what make a
  limit defensible, because you can see the pattern that triggered it.
- A shared limiter store (Postgres or Redis, both already configured) so limits
  survive the process restart that the MVP performs on every deploy.
- Legal copy on the pay page: limits are a product decision too, and a payer
  that gets a 429 during checkout needs a sentence explaining what to do next.

## Test plan

- cancel with no body -> 401, invoice still `PENDING` (regression test for row 1)
- cancel with a different key -> 401; with the correct key but no signature -> 401
- 11th `POST /invoices` from one IP inside the window -> 429 with `Retry-After`
- verification of the same invoice 11 times -> 429 on the 11th, and exactly one
  Horizon call attributed in logs
- 17 kB body -> 413, and the invoice count is unchanged
- invoice ceiling reached -> 503 and no partial write
- `simulate-payment` with `NODE_ENV=production` -> 404/403, status unchanged
- limits reset after the window: one call at t+window succeeds

## Non-goals

Reputation scoring, CAPTCHA, account systems and edge/WAF configuration. This
document only proposes limits the current single-instance MVP can enforce and
test.
