# Structured logging for the create → pay → verify → proof path

Status: **implemented** (issue #449). Event names and allow-listed fields live in
`backend/src/observability/log-events.ts`. Correlation middleware lives in
`backend/src/utils/request-correlation-id.ts`. This document is the single
operator-facing guide; do not add a parallel logging guide.

## Contract

Every operational record is one JSON object on stdout or stderr. The builder
copies only the allow-listed fields for that event; it never serializes a
request body, response body, invoice, Horizon response, or Error object.

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
| proof.downloaded | info | invoiceRef, txRef, proofFormat | PDF, text, or JSON proof action |
| horizon.request.failed | warn or error | operation, errorCode, network, attempt, durationMs | failed Horizon boundary |

Started and terminal events share `requestId`. A request emits exactly one
succeeded or rejected terminal event for create/verify. Reject paths
(`payment.verify.rejected`) stay distinct from outage paths
(`horizon.request.failed`).

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
