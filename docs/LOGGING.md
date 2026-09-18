# Structured logging for the create -> pay -> verify -> proof path

Status: Implemented (issue #449).

The backend and frontend implement an end-to-end structured logging and observability contract across the entire payment lifecycle (invoice creation, payment attempts, verification, settlement, and proof download). Every log line is emitted as a single, machine-parseable JSON object with strict redaction guarantees and zero new external runtime dependencies.

## Constraints & Architecture

1. **Zero new runtime dependencies**: Uses Node.js standard runtime logging (`console.log`, `console.warn`, `console.error`) with structured JSON serialization.
2. **One line per event**: Exactly one newline-delimited JSON record per log event, enabling reliable indexing and streaming log aggregators.
3. **Correlation ID propagation**:
   - Inbound HTTP requests accept `X-Correlation-Id` or `X-Request-Id` headers.
   - If missing or invalid (non-printable, malformed, or exceeds 128 characters), the server generates a fresh ID via `createRequestId()` (format: `req-<16 hex>`).
   - The correlation ID is echoed back on all HTTP responses via both `X-Correlation-Id` and `X-Request-Id` headers.
   - Frontend API clients automatically attach both headers to every outgoing request via Axios interceptors.
   - Asynchronous execution flows carry the correlation ID via `AsyncLocalStorage` (`requestContext`).
4. **Strict redaction and privacy guarantees**:
   - PII (such as customer email, payer name) is strictly forbidden from all log records.
   - Secret keys and seed phrases are strictly forbidden and never logged.
   - Wallet public keys and transaction IDs are consistently obfuscated via secure references (`logReference(id)`).
   - Raw payment memos and payload metadata are omitted from log payloads.
5. **Rejection vs Downstream Outage Distinction**:
   - Normal business rejection (e.g. invalid tx hash, memo mismatch, unpaid status) is emitted as `payment.verify.rejected` at `warn` level with an `errorCode`.
   - Downstream infrastructure failures (e.g. Horizon 5xx errors, timeouts, connection drops) are distinctly emitted as `horizon.request.failed` at `error` level with operation, attempt, and duration.

## Standardized Event Taxonomy (11 Events)

All emitted events conform strictly to the following 11-event taxonomy and permitted field sets:

| # | Event | Level | Emitted When | Permitted Fields |
|---|---|---|---|---|
| 1 | `invoice.create.started` | `info` | Inbound `POST /api/invoices` validation begins | `sellerRef`, `assetCode`, `network`, `storage` |
| 2 | `invoice.create.succeeded` | `info` | Invoice stored and payment payload generated | `sellerRef`, `invoiceRef`, `assetCode`, `network`, `storage`, `durationMs` |
| 3 | `invoice.create.rejected` | `warn` | Validation or business rule fails creation | `sellerRef`, `errorCode`, `network`, `storage`, `durationMs` |
| 4 | `payment.attempt.started` | `info` | Client initiates payment attempt or simulation | `invoiceRef`, `network` |
| 5 | `payment.attempt.submitted` | `info` | Payment transaction hash submitted | `invoiceRef`, `txRef`, `network`, `durationMs` |
| 6 | `payment.attempt.rejected` | `warn` | Payment attempt rejected before submission | `invoiceRef`, `errorCode`, `network`, `durationMs` |
| 7 | `payment.verify.started` | `info` | Payment verification process initiated | `invoiceRef`, `txRef`, `network` |
| 8 | `payment.verify.rejected` | `warn` | Payment verification failed business checks | `invoiceRef`, `txRef`, `errorCode`, `network`, `durationMs` |
| 9 | `invoice.paid` | `info` | Invoice transitioned to `PAID` status | `invoiceRef`, `sellerRef`, `txRef`, `assetCode`, `network`, `storage`, `durationMs` |
| 10 | `proof.downloaded` | `info` | Quittance proof exported (JSON or PDF) | `invoiceRef`, `txRef`, `proofFormat` |
| 11 | `horizon.request.failed` | `error` | Downstream Stellar Horizon RPC outage | `operation`, `errorCode`, `network`, `attempt`, `durationMs` |

## Context & Common Fields

Every JSON log record contains standard top-level fields:

| Field | Type | Description |
|---|---|---|
| `timestamp` | string | ISO-8601 UTC timestamp with millisecond precision |
| `level` | string | One of `'info'`, `'warn'`, `'error'` |
| `event` | string | One of the 11 standardized event names |
| `requestId` | string | Active correlation ID (`req-...` or client correlation ID) |
| `service` | string | Service identifier (`'api'` or `'web'`) |
| `environment` | string | Node environment (e.g. `'development'`, `'production'`, `'test'`) |

## Sample Log Records

### Happy Path: Creation to Proof Download

```json
{"timestamp":"2026-09-18T07:47:01.128Z","level":"info","event":"invoice.create.started","requestId":"req-3f9c1a7b2d4e6081","service":"api","environment":"production","sellerRef":"GB3Q...RKG4","assetCode":"XLM","network":"TESTNET","storage":"postgres"}
{"timestamp":"2026-09-18T07:47:01.163Z","level":"info","event":"invoice.create.succeeded","requestId":"req-3f9c1a7b2d4e6081","service":"api","environment":"production","sellerRef":"GB3Q...RKG4","invoiceRef":"148d...b55b","assetCode":"XLM","network":"TESTNET","storage":"postgres","durationMs":35}
{"timestamp":"2026-09-18T07:47:01.164Z","level":"info","event":"payment.attempt.started","requestId":"req-3f9c1a7b2d4e6081","service":"api","environment":"production","invoiceRef":"148d...b55b","network":"TESTNET"}
{"timestamp":"2026-09-18T07:47:01.164Z","level":"info","event":"payment.attempt.submitted","requestId":"req-3f9c1a7b2d4e6081","service":"api","environment":"production","invoiceRef":"148d...b55b","txRef":"3b8e...4487","network":"TESTNET","durationMs":0}
{"timestamp":"2026-09-18T07:47:01.164Z","level":"info","event":"invoice.paid","requestId":"req-3f9c1a7b2d4e6081","service":"api","environment":"production","invoiceRef":"148d...b55b","sellerRef":"GB3Q...RKG4","txRef":"3b8e...4487","assetCode":"XLM","network":"TESTNET","storage":"postgres","durationMs":0}
{"timestamp":"2026-09-18T07:47:01.165Z","level":"info","event":"proof.downloaded","requestId":"req-3f9c1a7b2d4e6081","service":"api","environment":"production","invoiceRef":"148d...b55b","txRef":"3b8e...4487","proofFormat":"pdf"}
```

### Business Rejection Path

```json
{"timestamp":"2026-09-18T07:47:01.186Z","level":"warn","event":"payment.verify.rejected","requestId":"req-97939b890b265328","service":"api","environment":"production","invoiceRef":"148d...b55b","errorCode":"MEMO_MISMATCH","network":"TESTNET","durationMs":12}
```

### Downstream Stellar Horizon Outage

```json
{"timestamp":"2026-09-18T07:47:01.186Z","level":"error","event":"horizon.request.failed","requestId":"req-c4651e0906449397","service":"api","environment":"production","operation":"getTransaction","errorCode":"HORIZON_UNAVAILABLE","network":"TESTNET","attempt":1,"durationMs":502}
```
