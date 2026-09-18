# Abuse controls for the public pay and verify endpoints

Status: Implemented (Issues #383, #450).

## What the surface looks like

| Control | Implementation |
|---|---|
| Rate limiting across sensitive endpoints | Token-bucket middleware in `backend/src/middleware/rate-limit.ts` with sliding IP/target windows |
| Request body limit | Hard limit (default 16 kB) configured via `express.json({ limit })` and `bodyLimitErrorHandler` in `backend/src/middleware/body-limit.ts` |
| Verification concurrency lock | Mutex per invoice in `backend/src/middleware/rate-limit.ts` returning 429 `VERIFY_IN_PROGRESS` |
| Verification lookup cache | Caches verified/rejected Horizon lookups in `backend/src/middleware/verify-cache.ts` |
| Cancellation signature verification | Ed25519 cryptographic signature required on `POST /invoices/:id/cancel` |
| Storage capacity ceiling | In-memory invoice ceiling guard in `backend/src/middleware/invoice-ceiling.ts` returning 503 `INVOICE_STORE_FULL` |
| Production environment dev-route guard | `POST /invoices/:id/simulate-payment` guarded against `NODE_ENV=production` |

## Ranked Scenarios and Mitigations

| # | Scenario | How it works | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Unauthenticated cancellation** | `POST /invoices/:id/cancel` without proof of control | Live invoice sabotage | Cryptographic Ed25519 signature over invoice id verified against `sellerPublicKey`; returns 401 |
| 2 | **Owner check is a claimed string** | Claiming key in body without proving private key ownership | Unauthorized state change | Ed25519 signature verification enforced |
| 3 | **Verification amplification** | Repeated `POST /invoices/:id/verify` calls exhausting Horizon rate limits | Service degradation | Per-IP limit (30/min), per-invoice limit (10/min), concurrency lock, and verification cache |
| 4 | **Invoice flood** | Automated scripts flooding `POST /invoices` to exhaust memory | Memory exhaustion and noisy listing | Per-IP limits (5/min, 10/10min) and global store capacity ceiling (503) |
| 5 | **Cross-wallet enumeration** | Querying invoices across sellers | Metadata exposure | Invoices scoped to requesting seller public key |
| 6 | **Oversized bodies** | Large payloads consuming memory during JSON parse | Denial of service | Express 16 kB limit with RFC-compliant 413 `PAYLOAD_TOO_LARGE` JSON envelope |
| 7 | **Dev-only route exposure** | Calling dev simulation routes in production | Erroneous payment marking | Route guard returning 404 in production |

## Deterministic Middleware Order

To prevent resource consumption and bypass attacks, middleware execution order is strictly deterministic.

### Invoice Creation Pipeline (`POST /invoices`)
1. **Body Parser & Limit Guard (`bodyLimitErrorHandler`)**: Rejects payloads exceeding 16 kB with HTTP 413 (`PAYLOAD_TOO_LARGE`). Evaluated before any handler or limiter consumes compute.
2. **Rate Limiters (`createInvoiceRateLimiters`)**: Evaluates 1-minute (5 requests) and 10-minute (10 requests) IP token buckets. Exceeding quota returns HTTP 429 (`RATE_LIMIT_EXCEEDED`) with `Retry-After`.
3. **Invoice Ceiling Check (`createInvoiceCeilingMiddleware`)**: Checks in-memory store capacity. If full, returns HTTP 503 (`INVOICE_STORE_FULL`).
4. **Route Handler (`handlers.createInvoice`)**: Validates schema and stores invoice.

### Invoice Verification Pipeline (`POST /invoices/:id/verify`)
1. **Rate Limiters (`createVerifyRateLimiters`)**: Evaluates IP bucket (30/min) and invoice target bucket (10/min). Returns HTTP 429 (`RATE_LIMIT_EXCEEDED`) with `Retry-After`.
2. **Concurrency Lock (`verifyConcurrencyLock`)**: Ensures only 1 in-flight Horizon verification per invoice. Concurrent calls return HTTP 429 (`VERIFY_IN_PROGRESS`) with `Retry-After: 5`.
3. **Verification Cache (`verifyCacheMiddleware`)**: Checks in-memory/Redis cache for previous results on `(invoiceId, txHash)`. Cache hits return the status and response immediately with `{ cached: true }`.
4. **Route Handler (`handlers.verifyPayment`)**: Performs Horizon lookup and updates invoice status. Results are recorded in the verification cache.

## Environment Configuration

All abuse control limits support environment variable configuration:

| Variable | Default | Description |
|---|---|---|
| `MAX_BODY_BYTES` | `16384` | Maximum allowable request body size in bytes |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Base rate limit window in milliseconds |
| `RATE_LIMIT_INVOICE_CREATE_PER_MIN` | `5` | Maximum invoice creations per minute per IP |
| `RATE_LIMIT_INVOICE_CREATE_PER_10MIN` | `10` | Maximum invoice creations per 10 minutes per IP |
| `RATE_LIMIT_VERIFY_PER_MIN_IP` | `30` | Maximum verification requests per minute per IP |
| `VERIFY_INVOICE_LIMIT` | `10` | Maximum verification requests per minute per invoice |
| `VERIFY_INVOICE_WINDOW_MS` | `60000` | Target invoice verification window in milliseconds |
| `INVOICE_STORAGE_CEILING` | `5000` | Maximum total invoices allowed in memory store |

## Client Error Handling Contracts

Frontend error handling surfaces rate limits and server capacities cleanly:
- **HTTP 413 (`PAYLOAD_TOO_LARGE`)**: Flagged as `retryable: true`, surfaces specific payload limit message, and avoids resetting checkout state.
- **HTTP 429 (`RATE_LIMIT_EXCEEDED` / `VERIFY_IN_PROGRESS`)**: Flagged as `retryable: true`, preserves server message, and respects `Retry-After`.
- **HTTP 503 (`INVOICE_STORE_FULL` / Outages)**: Handled as temporary server unavailability rather than payment mismatches.

## Non-goals

Reputation scoring, CAPTCHA, external account KYC systems, and cloud WAF automation. These controls operate natively within the application runtime.
