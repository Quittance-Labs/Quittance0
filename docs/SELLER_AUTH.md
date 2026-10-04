# Seller wallet sessions

Seller workspace access requires proof that the caller controls the connected
Stellar account. A public wallet address is an identifier, not a credential.
The same shared router enforces this contract in the in-memory, Postgres and
dual server entrypoints.

## Configure the API

Set these backend environment variables before opening the seller dashboard:

| Variable | Value |
| --- | --- |
| `STELLAR_NETWORK` | `TESTNET` or `PUBLIC`; the passphrase comes from `shared/network.ts` |
| `SELLER_AUTH_HOME_DOMAIN` | Application host, optionally including a port; for local use `localhost:3000` |
| `SELLER_AUTH_WEB_AUTH_DOMAIN` | API host, optionally including a port; defaults to the home domain |
| `SELLER_AUTH_SIGNING_SECRET` | Dedicated Stellar keypair secret used only to sign challenges |
| `SELLER_SESSION_ACTIVE_KEY_ID` | ID of the HMAC key used to issue new sessions |
| `SELLER_SESSION_KEYS` | JSON object mapping key IDs to canonical base64 secrets of at least 32 bytes |

Generate a dedicated challenge signing key and a session key locally, from the
`backend` directory where the existing Stellar SDK is installed:

```sh
node -e "process.stdout.write(require('@stellar/stellar-sdk').Keypair.random().secret() + '\n')"
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64') + '\n')"
```

Put those values in backend environment configuration; keep them out of Git,
frontend variables and logs. The challenge signing key is separate from a
seller/payment wallet and does not need funds. For example, the shape of the
key ring is `{"current":"<base64 secret>"}`. Domains are host names, not URLs;
the home-domain limit is 59 ASCII characters because SEP-10 appends ` auth` to
its 64-byte manage-data name.

Missing/invalid auth configuration returns `503 AUTH_NOT_CONFIGURED` from the
authentication endpoints. Protected routes without a token still return 401;
public checkout remains available. Development has the same ownership rule as
production; neither `REQUIRE_CANCEL_SIGNATURE=false` nor `REQUIRE_SIGNATURES`
enables a bypass.

## Browser flow

1. The connected wallet requests
   `GET /api/auth/challenge?account=<G-address>&network=TESTNET`.
2. The API issues a random, server-signed SEP-10 challenge bound to the account,
   configured domains and pinned network passphrase, with a maximum five-minute
   lifetime. The response is `{success:true,data:{transaction,network,
   networkPassphrase,serverSigningKey,homeDomain,webAuthDomain,expiresAt}}`.
3. The frontend verifies the challenge with `WebAuth.readChallengeTx`, then asks
   Freighter to `signTransaction` for that account and passphrase. It checks the
   wallet again afterward and refuses a changed transaction or account. This
   transaction is never submitted to Stellar.
4. The signed XDR is exchanged at `POST /api/auth/session` with
   `{transaction,network}`. The API verifies both signatures using
   `WebAuth.verifyChallengeTxSigners`, checks the issued nonce and consumes it
   once. Invalid signatures do not consume another user's valid challenge.
5. The response contains `{success:true,data:{token,sellerPublicKey,network,
   expiresAt}}`. All `expiresAt` fields are UNIX seconds. The HMAC-signed token
   expires within one hour and includes its key ID, seller, network, domain,
   issuer and issuance/expiry times.

The frontend retains the token in memory for the current account and network.
It is never written to localStorage or the persisted wallet store. A synchronous
wallet subscription invalidates tokens and pending authentication on account,
network or connection changes, including an A → B → A switch while a signing
dialog is open. Old in-flight seller requests are aborted and their results
cannot populate the new wallet's workspace. A401 response triggers at most one
new challenge and one retry for the original wallet session. Anonymous pay-page
requests do not open wallet signing dialogs.

## Endpoint contract

| Endpoint | Authorization |
| --- | --- |
| `POST /api/invoices` | Required seller session; create identity is derived from it |
| `GET /api/invoices` | Required; list is scoped to the verified seller |
| `GET /api/invoices/stats` | Required; aggregates are scoped to the verified seller |
| `GET /api/invoices/:id/events` | Required; session must own this invoice |
| `POST /api/invoices/:id/cancel` | Required; session must own this invoice |
| `GET /api/invoices/:id` | Anonymous callers get the public DTO; only the owning session gets workspace fields |
| Payment info, verification and proof handoff | Existing public checkout contract |

Send `Authorization: Bearer <token>` on seller requests. The configured CORS
origins allow this header alongside the existing content and correlation
headers. Authenticated responses are `Cache-Control: no-store` and vary by
Authorization. A declared body, query or legacy header seller key must match
the session or the API returns 403. A raw
`?sellerPublicKey=<invoice owner>` query without a session never reveals
`customerEmail`, customer name or other private workspace fields.

Authentication errors keep the API's flat envelope:
`{success:false,code:"AUTH_SESSION_EXPIRED",error:"Seller session has expired"}`.
Missing, malformed, expired or replayed credentials return 401; seller/network
mismatches return 403. Challenge admission is bounded (10,000 unexpired records
per authority) and uses the existing IP limiter when edge rate limiting is
enabled; callers must wait after a 429 instead of opening unlimited challenges.

## Rotation and process topology

To rotate HMAC keys, add the new ID/secret to `SELLER_SESSION_KEYS`, retain the
old pair and make the new ID active. After every API process is updated and the
last old token's one-hour lifetime has elapsed, remove the old ID. Verification
selects the exact header key ID; a removed or unknown ID is rejected. Restart
processes to apply environment changes. Removing an ID immediately also revokes
all sessions signed with it.

Challenge nonce storage is bounded and process-local. Route issuance and
redemption to the same API process (sticky routing for this five-minute flow).
Other processes and restarted processes reject unknown challenges, so retrying
requires a new challenge. Session tokens are stateless and work across processes
that share the domain, network and key ring. No challenge or session requires a
database migration. Horizontal deployments needing cross-process challenge
redemption should replace the nonce authority with shared atomic storage before
removing sticky routing; the current implementation fails closed.

## Cancellation and script migration

The `cancel:<invoiceId>` / `signBlob` proof path has been removed. Cancellation
uses the same session as create, list and stats; no extra cancellation signature
or permissive development fallback exists. Old clients receive401 until they
perform the challenge exchange. The deprecated router option
`requireCancelSignature` is ignored for source compatibility and cannot weaken
session enforcement.

For `scripts/deploy-smoke.mjs`, provide `DEPLOY_SELLER_SESSION_TOKEN` from a fresh
challenge exchange. The created invoice's seller is derived from the token; the
subsequent read remains anonymous and checks the public pay-link contract.

The Testnet evidence script accepts `EVIDENCE_SELLER_SECRET` to perform the same
SEP-10 exchange using its configured `EVIDENCE_SELLER_PUBLIC_KEY`, or an unexpired
`EVIDENCE_SELLER_SESSION_TOKEN`. Its payer secret remains separate. It signs a
zero-sequence challenge without submitting it, and sends the resulting bearer
only on invoice creation. Authentication values never enter the public artifact.
The optional evidence CI step is gated on these seller credentials in addition
to its existing payer/API configuration; fork PRs still require no secrets.

## Acceptance checks

From `backend`, run `node --import tsx --test tests/seller-session.test.ts` for
the real SDK challenge exchange and mounted Express routes. It covers replay,
strict expiry, signer/network/domain mismatch, HMAC rotation, bounded nonces,
private pay-link fields, protected create/list/stats/events/cancel and CORS.

The frontend's `seller-session-api.test.js`, `seller-challenge.test.js` and
`wallet-session.test.js` cover real Axios request interception, Freighter's
signing boundary, wallet-switch races, memory-only tokens and one 401 refresh.
Existing payment/storage suites use explicit authenticated fixtures so their
original monetary, lifecycle, redaction and scoping assertions still apply.
