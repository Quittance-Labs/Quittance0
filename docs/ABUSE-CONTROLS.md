# Abuse controls for the public pay and verify endpoints

Status: implemented for the public edge (issues #383 / #450). The ranking
below is historical context for *why* the controls exist; the live wiring is
documented under "Middleware order" and driven by env (see edge-control
variables in `backend/env.mvp.example` and `backend/env.example.txt`).

## What the surface looks like today

| Fact | Evidence |
|---|---|
| Rate limiting on create / list / cancel / verify | `backend/src/middleware/rate-limit.ts` + `invoice.routes.ts` |
| Request bodies capped at 16 kB (env-overridable) | `express.json({ limit: MAX_BODY_STRING })` + `bodyLimitErrorHandler` → 413 `PAYLOAD_TOO_LARGE` |
| The invoice surface is public | `backend/src/routes/invoice.routes.ts` mounts create, list, payment-info, cancel, verify and the dev-only simulate route |
| Cancellation requires seller proof | auth pre-check + signature verification (401 / 403) before the cancel rate limit |
| The seller key is not a secret | `GET /invoices/:id/payment-info` returns the destination the payer must pay, which is the seller's public key |
| Verification caches outcomes to spare Horizon | `backend/src/middleware/verify-cache.ts` (replay with `cached: true`) |
| MVP storage is in-memory with a global ceiling | `INVOICE_CEILING` (default 5000) → 503 `INVOICE_STORE_FULL` |

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


## Middleware order (issue #450)

Composed in code (`middleware/edge-config.ts`, `routes/invoice.routes.ts`) so a
reordering cannot silently turn a 429 into a 413 (or vice versa):

1. **Body size** (app-level) → `413 PAYLOAD_TOO_LARGE`
2. **POST /invoices**: ceiling → create rate limits → handler  
   (`503 INVOICE_STORE_FULL`, then `429 RATE_LIMIT_EXCEEDED`)
3. **GET /invoices**: list rate limit → handler
4. **POST /invoices/:id/cancel**: auth pre-check → cancel rate limit → handler  
   (`401` before `429`)
5. **POST /invoices/:id/verify**: concurrency lock → verify rate limits → replay cache → handler  
   (`429 VERIFY_IN_PROGRESS`, `429 RATE_LIMIT_EXCEEDED`, cache hit, then handler
   `429 VERIFY_RATE_LIMIT_EXCEEDED`)

Frontend pay/verify UX maps `429` and `413` through `frontend/lib/edge-limit.js`
as retryable copy and never as memo/amount rejection.

## Edge-control environment variables

Every variable is listed in `backend/env.mvp.example` and `backend/env.example.txt`
and resolved by `resolveEdgeControlConfig()` with the safe demo defaults in the
table below.

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
| Horizon-dependent paths under load | 1 in-flight verify per invoice; all Horizon calls share a 4-concurrent budget with timeout + bounded retry (`utils/horizon-client.ts`) | 429 `VERIFY_IN_PROGRESS`; upstream Horizon 429s surface as 503 `VERIFY_UNAVAILABLE`, never a memo/amount rejection |

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
