# Structured logging for the create -> pay -> verify -> proof path

Status: proposal (issue #385). Nothing in this document is implemented yet; it
pins the event vocabulary and the field contract so the handler, monitor and
proof changes can land independently.

Today the backend logs 102 `console.*` calls. The invoice handlers already thread a
correlation id through `logError(label, error, requestId)`, which prefixes
`[req-<hex>]`, and `backend/src/utils/request-correlation-id.ts` generates that id.
What is missing is not the plumbing but a *shape*: an operator cannot answer
"what happened to invoice X" from the current output, because every line is a
free-form sentence.

## Constraints

1. **No new runtime dependency.** The MVP runs on Vercel and Render; a logger
   package is a deployment risk for a proof-of-payment tool. One small wrapper
   around `console.log` emitting a single JSON object per line is enough.
2. **One line per event.** No multi-line dumps; stack traces go in an `err.stack`
   field, not on their own lines, so a log query can grep one prefix.
3. **The correlation id is mandatory** on every server event. Reuse
   `createRequestId()` (format `req-<16 hex>`); the monitor is not request-scoped,
   so it synthesises one id per payment and reuses it for the whole
   detection -> verify -> PAID sequence.
4. **Redaction is a property of the schema**, not of the call site: the field
   dictionary below has no slot for a payer email, payer name or secret key.

## Event list

Fields marked * are required on that event; `req_id` is required on all of them.

| # | Event | Emitted when | Required fields beyond `req_id` |
|---|---|---|---|
| 1 | `http.request` | every inbound request, after the response is flushed | `method`, `path` (route pattern, not the raw URL), `http_status`, `dur_ms` |
| 2 | `invoice.created` | `POST /invoices` accepted | `invoice_id`, `amount`, `asset`, `expires_at`, `network` |
| 3 | `invoice.cancelled` | `POST /invoices/:id/cancel` | `invoice_id`, `status_before` |
| 4 | `payment.detected` | monitor sees a payment for a known memo / destination | `invoice_id`, `tx_hash`, `amount`, `asset`, `network`, `source_account` |
| 5 | `payment.unmatched` | monitor sees a payment it cannot attribute to an invoice | `tx_hash`, `amount`, `asset`, `reason` |
| 6 | `invoice.verify_ok` | `POST /invoices/:id/verify` matches every check | `invoice_id`, `tx_hash`, `status_before`, `status_after` (always `PAID`) |
| 7 | `invoice.verify_rejected` | any check in `payment-verification.ts` fails | `invoice_id`, `code` (one of the rejection codes), `check` (the failing step name) |
| 8 | `invoice.paid` | status becomes `PAID`, from verify or from the monitor | `invoice_id`, `tx_hash`, `paid_at`, `settled_late` |
| 9 | `invoice.expired` | `markExpiredInvoices()` (60s sweep) or lazy expiry on read | `invoice_id`, `expires_at`, `source` (`sweep` or `read`) |
| 10 | `invoice.simulate_payment` | dev-only `POST /invoices/:id/simulate-payment` | `invoice_id`, `node_env` |
| 11 | `proof.rendered` | frontend proof/receipt panel renders for a `PAID` invoice | `invoice_id`, `tx_hash`, `surface` (`receipt` or `proof_panel`) |
| 12 | `error.unhandled` | the express error handler catches a throw | `path`, `err.stack` |

Events 4, 8 and 9 are the ones that make a support question answerable: "the
payer says they paid" is `payment.detected` plus either `invoice.paid` or an
`invoice.verify_rejected` with a code.

## Field dictionary

| Field | Type | Notes |
|---|---|---|
| `ts` | string | ISO-8601 UTC, millisecond precision |
| `lvl` | `debug` \| `info` \| `warn` \| `error` | rejects are `warn`, unhandled throws are `error` |
| `evt` | string | one of the names above, snake_case, never localised |
| `req_id` | string | `req-<16 hex>` |
| `invoice_id` | string | public invoice id, safe to log |
| `status_before` / `status_after` | string | one of `PENDING`, `PAID`, `EXPIRED`, `CANCELLED` |
| `code` | string | rejection code, already single-sourced in `VERIFICATION_MESSAGES` |
| `check` | string | step name from the fixed order documented in `docs/VERIFY.md` |
| `tx_hash` | string | 64 hex chars; public chain data |
| `amount` / `asset` | string | as submitted, plus `asset_issuer` when the asset is not XLM |
| `network` | string | `TESTNET` or `PUBLIC`, from config, never from the request |
| `source_account` | string | the payer's Stellar account for *this* transaction only |
| `dur_ms` | number | integer milliseconds |
| `err.stack` | string | present only on `lvl=error` |

## Sample lines

Success path, create -> detect -> verify -> proof:

```json
{"ts":"2026-09-13T09:14:02.118Z","lvl":"info","evt":"invoice.created","req_id":"req-3f9c1a7b2d4e6081","invoice_id":"inv_8Qm2","amount":"250.0000000","asset":"USDC","asset_issuer":"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5","expires_at":"2026-09-20T09:14:02.101Z","network":"TESTNET"}
{"ts":"2026-09-13T09:21:44.902Z","lvl":"info","evt":"payment.detected","req_id":"req-9b2e05c7d31f4a86","invoice_id":"inv_8Qm2","tx_hash":"8f1c...64 hex...","amount":"250.0000000","asset":"USDC","network":"TESTNET","source_account":"GDQP...PAYER"}
{"ts":"2026-09-13T09:21:45.033Z","lvl":"info","evt":"invoice.verify_ok","req_id":"req-9b2e05c7d31f4a86","invoice_id":"inv_8Qm2","tx_hash":"8f1c...","status_before":"PENDING","status_after":"PAID"}
{"ts":"2026-09-13T09:21:45.061Z","lvl":"info","evt":"invoice.paid","req_id":"req-9b2e05c7d31f4a86","invoice_id":"inv_8Qm2","tx_hash":"8f1c...","paid_at":"2026-09-13T09:21:44Z","settled_late":false}
{"ts":"2026-09-13T09:22:10.400Z","lvl":"info","evt":"proof.rendered","req_id":"req-1c77d0aa4b9e3f52","invoice_id":"inv_8Qm2","tx_hash":"8f1c...","surface":"proof_panel"}
```

Reject path, wrong memo:

```json
{"ts":"2026-09-13T10:02:31.775Z","lvl":"info","evt":"http.request","req_id":"req-5ae81c0db39f7422","method":"POST","path":"/api/invoices/:id/verify","http_status":400,"dur_ms":812}
{"ts":"2026-09-13T10:02:31.774Z","lvl":"warn","evt":"invoice.verify_rejected","req_id":"req-5ae81c0db39f7422","invoice_id":"inv_8Qm2","code":"MEMO_MISMATCH","check":"memo"}
{"ts":"2026-09-13T10:03:07.010Z","lvl":"info","evt":"payment.unmatched","req_id":"req-77b1e4c9a2d05f36","tx_hash":"c40d...","amount":"12.0000000","asset":"XLM","reason":"no_invoice_for_memo"}
{"ts":"2026-09-13T10:04:55.233Z","lvl":"error","evt":"error.unhandled","req_id":"req-0d3a9f61c72b48e5","path":"/api/invoices","err.stack":"Error: ...\n    at ..."}
```

A rejected verify is `warn`, not `error`: a wrong memo is a payer mistake the product
expects, and paging on it would train the operator to ignore the level.

## Privacy checklist

The product promise is that a proof exposes *this* payment and nothing else.
Logging has to hold the same line.

- **Never log** payer name or payer email, even though `POST /invoices` accepts
  both and validates them (`INVALID_PAYER_EMAIL`, `PAYER_INFO_TOO_LONG`). They are PII
  and are not needed to debug a payment; log `payer_info: true/false` at most.
- **Never log** Stellar secret keys, seed phrases, or the contents of
  `env.mvp.example`-style configuration. Verify config presence by boolean.
- **Do not log other wallets' history.** `source_account` appears once, for the
  transaction being verified. The monitor must not dump the seller account's
  full payment stream into logs, and a payment with no matching invoice is
  logged as `payment.unmatched` with the tx hash and reason only.
- **Memos are public chain data** and are already part of the proof, so they may
  be logged; invoice ids are public too. Neither is PII.
- **Amounts and asset issuers are public.** The seller's public key is public.
- If an incident ever needs payer contact details, they are read from storage
  under the seller's own authorisation, not copied into log lines.

## Rollout

1. Add `backend/src/utils/log.ts` with `log(evt, fields)` and `logError(evt, err, fields)`;
   pretty-print in development, raw JSON in production.
2. Convert the handlers first (events 1-3, 6, 7, 10); they already carry a
   request id, so this is a mechanical replacement of `logError` call sites.
3. Convert the monitor next (events 4, 5, 8, 9); it needs `settled_late` from the
   policy in `docs/EXPIRY-AND-LATE-PAYMENT.md`.
4. Frontend `proof.rendered` is the only client-side event; it is fire-and-forget and
   must never block rendering or throw.
5. Add a test that asserts one JSON object per line and that the forbidden
   field names above never appear in serialised events.
