# Structured logging for the create → pay → verify → proof path

Status: **implemented** (issue #449). Event names and allow-listed fields live in
`backend/src/observability/log-events.ts`. Correlation middleware lives in
`backend/src/utils/request-correlation-id.ts`. This document is the single
operator-facing guide; do not add a parallel logging guide.

## Contract

Request, invoice/payment, cache replay, and failure records are JSON objects on
stdout or stderr. Fixed startup banners and aggregate maintenance counts can
also appear; they are not lifecycle events or inputs to the metrics below. The builder
copies only the allow-listed fields for that event; it never serializes a
request body, response body, invoice, Horizon response, or Error object.

The same rule applies to lower-level storage, Redis, Stellar, and controller
diagnostics. A structured event does not make a parallel plaintext dump safe.
Request completion records use the registered route template (for example,
`/invoices/:id/verify`) or `unmatched`, never `req.path`, query strings, or a
concrete pay link. Failure diagnostics use the closed operation catalog and a
derived stable code; caught exceptions are not passed to the logger.

Base fields on every event:

| Field | Meaning |
| --- | --- |
| timestamp | UTC ISO-8601 emission time |
| level | info, warn, or error |
| event | stable taxonomy name |
| requestId | server correlation id (`req-<16 hex>`) |
| service | `api` or `web` |
| environment | deployment name when configured |

Identifiers use `invoiceRef`, `sellerRef`, and `txRef`. They are the first 16 hex
characters of HMAC-SHA256 under `LOG_FINGERPRINT_KEY`. The key is a deployment
secret and is never logged. If it is absent, references become `redacted` rather
than falling back to the raw value.

## Correlation

Express generates (or reuses a validated inbound) request id at the first
middleware, attaches it to the request, returns it as `X-Request-Id`, and reuses
it in every handler and Horizon call for that request. Only values matching
`req-<16 hex>` are accepted from `X-Request-Id` / `X-Correlation-Id`; anything
else is replaced with a fresh server id so log injection cannot land in the key.

The browser creates one request id for the pay action and sends it in
`X-Request-Id`. Automatic monitoring creates a fresh request id per observed
operation because it has no HTTP request.

## Events

| Event | Level | Required event fields | Emission point |
| --- | --- | --- | --- |
| invoice.create.started | info | sellerRef, assetCode, network, storage | after request validation |
| invoice.create.succeeded | info | sellerRef, invoiceRef, assetCode, network, storage, durationMs | after response data is ready |
| invoice.create.rejected | warn | sellerRef when available, errorCode, network, storage, durationMs | one terminal create failure |
| payment.attempt.started | info | invoiceRef, network | immediately before wallet flow |
| payment.attempt.submitted | info | invoiceRef, txRef, network, durationMs | wallet returns transaction hash |
| payment.attempt.rejected | warn | invoiceRef, errorCode, network, durationMs | wallet or submission rejects |
| payment.verify.started | info | invoiceRef, txRef, network | after hash validation, before Horizon |
| payment.verify.rejected | warn | invoiceRef, txRef, errorCode, network, durationMs | one terminal verification rejection |
| invoice.paid | info | invoiceRef, sellerRef, txRef, assetCode, network, storage, durationMs | committed PENDING→PAID |
| proof.downloaded | info | invoiceRef, txRef, proofFormat | legacy, unmounted backend proof controller |
| proof.handoff | info | invoiceRef, txRef, proofFormat, handoff | browser print window populated or TXT download dispatched |
| horizon.request.failed | warn or error | operation, errorCode, network, attempt, durationMs | failed Horizon boundary |
| http.request.completed | info | method, route, statusCode, durationMs | response finishes, including parser failures and unmatched routes |
| operation.failed | warn or error | operation, errorCode | failed API, storage, cache, QR, monitor, or Stellar boundary |
| payment.verify.cached | info | invoiceRef, txRef, httpStatus | a previously recorded verification response is replayed |

Started and terminal events share `requestId`. A request emits exactly one
succeeded or rejected terminal event for create/verify. Reject paths
(`payment.verify.rejected`) stay distinct from outage paths
(`horizon.request.failed`).

Cache replays are counted separately: they do not emit another `invoice.paid`
or imply a second settlement. The request completion and replay events reuse
the response correlation id. Identifier fingerprints still fail closed to
`redacted` when the deployment key is absent.

### Proof coverage boundary

Current receipt exports run in the browser. After a print window is populated
or the TXT download is dispatched, the browser sends a best-effort
`POST /api/invoices/:id/proof-handoff` with only `proofFormat` and `handoff`.
The shared router accepts only `pdf` / `print-window` and `text` / `download`,
requires the stored invoice to be `PAID` under the existing proof policy, and
derives keyed invoice/transaction references from that stored record. Supplied
references, transaction hashes, status, proof contents, and other extra fields
are rejected. The event and HTTP completion share the browser's correlation id;
the keyed `invoiceRef` links them to create and payment events across requests.

`proof.handoff` describes the browser action only. It is not confirmation that
the user printed, saved, opened, or retained a file. A blocked popup or failure
before the handoff produces no observation. Observation failure does not change
the proof or show a delivery error: the request has a 1.5-second timeout, no
retry, and no persistent queue. Existing production rate limiting admits at
most 30 observations per client IP per minute; dropped observations may
undercount handoffs. The route does not mutate invoice or payment state, return
invoice fields, or query Horizon.

The observation handler and completed-response logger contain sink failures.
An unavailable sink can reject the observation, but cannot throw out of the
response-finish listener and terminate the process after its response.

The legacy backend proof controller remains unmounted. Its `proof.downloaded`
event and the unused canonical JSON export are not evidence of browser file
save completion. Browser proof handoff coverage uses the actual mounted route;
external wallets, production PostgreSQL, and successful OS save remain separate.

`errorCode` is a bounded stable code such as `MEMO_MISMATCH`, `HORIZON_UNAVAILABLE`,
or `VALIDATION_FAILED`. Error messages and stack traces go to a restricted debug
sink only if the deployment has one; they are not fields in the operational event.

## Success example

```json
{"timestamp":"2026-09-13T10:00:00.517Z","level":"info","event":"invoice.paid","requestId":"req-8a7e81bbd9ef2731","service":"api","environment":"production","invoiceRef":"b67182fb83edb7ca","sellerRef":"eb8f707a26e08a9c","txRef":"69246b51fd8bb68c","assetCode":"XLM","network":"TESTNET","storage":"postgres","durationMs":418}
```

## Reject example

```json
{"timestamp":"2026-09-13T10:01:14.012Z","level":"warn","event":"payment.verify.rejected","requestId":"req-12a570aa9f2fa3c4","service":"api","environment":"production","invoiceRef":"b67182fb83edb7ca","txRef":"930dc03a1f4d4bc7","errorCode":"MEMO_MISMATCH","network":"TESTNET","durationMs":92}
```

## Outage example

```json
{"timestamp":"2026-09-13T10:02:01.100Z","level":"error","event":"horizon.request.failed","requestId":"req-4c91d0aa7b2e3f51","service":"api","environment":"production","operation":"getTransaction","errorCode":"HORIZON_UNAVAILABLE","network":"TESTNET","attempt":1,"durationMs":812}
```

## Never log

- secret keys, seed phrases, signatures, auth headers, cookies, or tokens
- raw seller or payer wallet addresses (use keyed refs only)
- invoice ids, public pay links, QR payloads, or full transaction hashes
- invoice memos, descriptions, customer names, seller names, or email
- amount together with a linkable seller, payer, invoice, or transaction
- XDR, Horizon response bodies, request bodies, or response bodies
- wallet balances, account history, or operations unrelated to this invoice
- IP address or user agent unless a separate retention and consent policy requires them
- raw Error objects, which may embed URLs, request configuration, or payloads

Dashboard list/stats/pay-info paths must not dump foreign wallet activity into
logs. Query Horizon only for the invoice or configured seller account needed by
the operation; never dump an account payments page to logs.

## Privacy checklist

- Fingerprint each identifier independently; do not concatenate raw values before logging.
- Keep `LOG_FINGERPRINT_KEY` outside source control; use different keys per environment.
- Limit production log access and retention in the hosting provider.
- Do not export production logs into demo evidence.
- Verify rejection logs contain a stable code without expected/received memo values.
- Review new event fields against the allow-list test before merge.

The regression suite captures all console channels around actual Express HTTP
requests and service callbacks, in addition to the structured sink assertions:

```sh
cd backend
node --import tsx --test tests/observability.test.ts tests/runtime-log-privacy.test.ts tests/proof-handoff.test.ts
npm run typecheck
cd ../frontend
node --test tests/proof-handoff.test.js tests/payment-proof-policy.test.js
```

It uses local Horizon fixtures for success, memo rejection, service outage,
account errors, and a payment stream. No live wallet or provider activity is
required. It also exercises cached verification, parser failures through all
three entrypoints, and database/cache exception boundaries.

## Metrics without Redis

The JSON stream is the source for low-cardinality metrics. Count and group only
by event, errorCode, network, assetCode, storage, and environment — never by
invoiceRef, sellerRef, txRef, or requestId.

| Metric | Derivation |
| --- | --- |
| invoices_created_total | count invoice.create.succeeded |
| invoice_create_reject_total | count invoice.create.rejected by errorCode |
| verification_total | count invoice.paid plus payment.verify.rejected |
| verification_reject_total | count payment.verify.rejected by errorCode |
| horizon_failure_total | count horizon.request.failed by errorCode |
| verify_duration_ms | distribution of terminal verify durationMs |
| proof_download_total | count proof.downloaded by proofFormat |
| proof_handoff_total | count proof.handoff by proofFormat and handoff; browser handoffs, not saved files |
