# Seller webhooks

Connect invoice events to an accounting, fulfillment or notification service from
**Dashboard → Webhooks**. Each action asks Freighter to sign the exact operation.
Opening the dashboard does not open a wallet prompt.

Supported events: `invoice.created`, `invoice.paid`, `invoice.cancelled`,
`invoice.expired`, `payment.rejected`. Rejected and partial-payment audit records
both emit `payment.rejected`. A test delivery uses `invoice.created` with
`test: true`, bypasses event filters, and contains no fabricated invoice ID.

## Enable

Run `npm run db:migrate` in `backend` before enabling PostgreSQL delivery. Set:

```dotenv
WEBHOOKS_ENABLED=true
WEBHOOK_ENCRYPTION_KEY=<64 hex characters from openssl rand -hex 32>
WEBHOOK_MAX_ATTEMPTS=8
WEBHOOK_DISABLE_AFTER_FAILURES=10
```

Keep the encryption key server-only, stable across restarts, and shared by replicas.
Store it in the deployment secret manager. Changing it without re-encrypting stored
endpoint secrets makes those keys unreadable. It is separate from each seller's
generated `whsec_...` signing secret.

All three server entrypoints mount the same API and start/stop the worker with the
server. Imports alone do not start a worker. With delivery disabled, sellers can
still list/remove endpoints, but register/rotate/test return 503.

**Use PostgreSQL for durability.** The memory MVP has equivalent in-process
behavior; its invoices, endpoints, replay protection and outbox are lost on restart.

## Dashboard and signed API

An account may register five endpoints. URLs must use HTTPS and resolve only to
public addresses, including in development. Credentials and fragments are refused.
The panel supports add, remove, test, rotate, and manual refresh of the latest 50
deliveries. Tests are limited to one per endpoint per minute. Removed endpoints
retain history and cancel pending work; a request already in flight may complete.

The signing secret appears once on registration/rotation. Copy it into the receiver
and dismiss it. List/history never return plaintext, hashes or ciphertext. The
browser keeps the returned secret only in component memory and discards it on
wallet/network changes, including changes while a signing request is in flight.

Rotation keeps the previous key valid for 24 hours. Deliveries carry both signatures
during that window. Further rotation is refused until the overlap expires so it
cannot invalidate the promised old-key window. To resume a disabled endpoint,
repair the receiver, remove the endpoint and register it again.

All paths below are POSTs under `/api`, and all require a wallet proof in the body:

| Path | Action | Additional signed fields | Successful data |
| --- | --- | --- | --- |
| `/webhooks` | register | URL and event filters | endpoint, one-time secret |
| `/webhooks/list` | list | none | endpoints, recent deliveries |
| `/webhooks/:id/remove` | remove | endpoint ID | ID, removed=true |
| `/webhooks/:id/rotate` | rotate | endpoint ID | endpoint, secret, previousSecretExpiresAt |
| `/webhooks/:id/test` | test | endpoint ID | eventId |

Common body fields are `sellerPublicKey`, integer Unix-seconds `timestamp`,
UUID `nonce`, and base64 Ed25519 `signature`. Sign the UTF-8 bytes produced by
`webhookProofMessage` in `shared/webhooks.ts`, using the same Freighter
`signBlob` and backend `verifySellerSignature` mechanism as cancellation.

The canonical message binds a versioned domain, seller, action, endpoint ID, exact
URL, sorted filters, timestamp and nonce. Normalize the URL before signing and send
those exact bytes. Proofs must be less than five minutes old and no more than 30
seconds in the future. Each nonce is consumed once in storage; PostgreSQL shares
replay protection and endpoint registration limits across API instances. Responses
use `Cache-Control: no-store`.

## Receiver signature and deduplication

Each POST includes:

```text
Content-Type: application/json
X-Quittance-Event-Id: <stable UUID>
X-Quittance-Event-Type: invoice.paid
X-Quittance-Signature: t=<Unix seconds>,v1=<hex HMAC>[,v1=<retiring-key HMAC>]
```

Compute HMAC-SHA256 with the literal UTF-8 `whsec_...` secret over
`timestamp + "." + original_body_bytes`. Do not decode the secret or parse and
re-serialize JSON before verification. Each retry has a fresh signed timestamp
and the same event ID/body.

The exported `verifyWebhookSignature` helper implements this contract. An
equivalent Node receiver:

```js
const { createHmac, timingSafeEqual } = require('node:crypto');

function verify(secret, header, rawBody, now = Math.floor(Date.now() / 1000)) {
  if (typeof header !== 'string' || header.length > 1024) return false;
  const fields = header.split(',').map(value => value.trim());
  const times = fields.filter(value => value.startsWith('t='));
  if (times.length !== 1 || !/^t=\d{1,12}$/.test(times[0])) return false;
  const timestamp = Number(times[0].slice(2));
  if (Math.abs(now - timestamp) > 300) return false;
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.').update(rawBody).digest();
  return fields.some(value => /^v1=[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(expected, Buffer.from(value.slice(3), 'hex')));
}
```

For an Express receiver, use `express.raw({ type: 'application/json' })` for
this route before the JSON parser. Verify first, then parse. Atomically record
`payload.id` with the receiving business change, then acknowledge with 2xx.
Return 2xx for an already-processed ID without repeating the business change.

Do not rely on arrival order. Concurrent invoice transactions can become visible
in a different order; use ledger settlement time and the current invoice state
when reconciling.

### Signature vector

```text
secret:    whsec_test_0123456789abcdef
timestamp: 1735689600
body:      {"id":"evt_1","type":"invoice.paid"}
HMAC:      7489caff2d92322967b02be31d80ec2a16eb05ba167bbd9719f630fc84eedd07
```

There is no newline after the body. This small body is a cryptographic vector,
not a full event. Set the verifier's test clock to that timestamp; a live receiver
correctly rejects the old timestamp.

## Payload privacy

Events contain `version: 1`, `id`, `type`, `createdAt` and an invoice projection:
ID, decimal-string amount, asset code/issuer, status and expiry. Paid events may add
transaction hash, ledger settlement time and late-payment classification.
Rejections may add only a stable code and transaction hash in `payment`.

SQL constructs this explicit field whitelist. Memory writes and every delivery
attempt pass through the stricter webhook projection in
`payment-event-redaction.ts`. Names/emails, payer identity, memo, description,
metadata, raw errors and unknown nested fields are excluded. Receiver bodies are
discarded and never retained/logged. Endpoint secrets have a SHA-256 hash plus
AES-256-GCM ciphertext; a hash alone cannot produce HMAC signatures.

## Atomic outbox and retries

PostgreSQL AFTER triggers enqueue in the same transaction as creation, the existing
paid UPDATE/audit CTE, cancellation, expiry, and rejection audit insertion.
Cancellation/expiry now write payment audit events too. An outbox insert failure
rolls back invoice and audit changes. Repeated writes of the same status produce
no additional lifecycle event. Subscribed endpoints each receive one row under
the unique `(endpoint_id, event_id)` constraint.

Semantic/claim rejection responses are cached only after their audit/outbox write
commits. Failed event storage returns a fixed 503 and leaves verification retryable.

Workers use `FOR UPDATE OF d,e SKIP LOCKED` and retain row/endpoint locks until
the bounded HTTP attempt and result commit finish. Other processes skip those
rows. Endpoint locking serializes its failure counter. A process crash rolls back
the claim and makes the same event available again. Memory storage performs
fallible event preparation before changing invoices, audits or transaction claims.

Delivery is **at least once**. If a receiver accepts an event and the worker dies
before recording success, another worker sends the same ID again. Database locks
cannot stop business work already started by a remote receiver after a crash;
receiver-side deduplication is required.

Each attempt repeats DNS checks and pins an approved address while retaining the
original TLS hostname verification. Any private, loopback or link-local answer
is rejected. Redirects are never followed. DNS has a two-second deadline and the
TLS/HTTP request a five-second deadline. An unsafe URL/address immediately
dead-letters the event and disables its endpoint.

Other non-2xx/transport failures use the existing monitor backoff: 1, 2, 4, 8, 16,
30, 30 seconds, plus 0–25% jitter. The default maximum is eight attempts. Ten
consecutive failed attempts across an endpoint's deliveries disable it; success
resets the counter. Remaining pending events become dead letters. Configuration
bounds are 1–20 attempts and 1–100 consecutive failures.

The worker polls every second and processes at most 25 rows per pass, without
overlapping its own passes. History exposes attempt, next retry, status, last
response code and safe failure code. Existing structured logging records
`webhook.worker`/`webhook.manage` failures without URLs, secrets or bodies.
Rows are retained for diagnosis; this change does not silently delete old history.

## Acceptance

```sh
cd backend
npm run typecheck
node --import tsx --test tests/webhook-delivery.test.ts
DATABASE_URL=postgresql://... node --import tsx --test tests/webhook-postgres.integration.test.ts
```

Delivery acceptance includes the vector, rotation, registration/send SSRF checks,
memory rollback, actual HTTP 500/500/200 delivery, in-process exclusion, signed
management, and the rejection storage/cache boundary. The test receiver explicitly
injects loopback transport; there is no production private-address bypass. Its
controlled clock records 1125 ms and 2250 ms retry schedules without waiting.

PostgreSQL acceptance uses an isolated schema and separate OS processes for atomic
rollback, exclusive claims, and SIGKILL/restart recovery. It explicitly skips when
DATABASE_URL is absent. Frontend `tests/seller-webhooks.test.js` covers signing,
the full panel, wallet/network switches and stale secret responses.
