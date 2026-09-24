# Abuse Controls Migration Guide

## Quick Start

### 1. Install Dependencies (if needed)
No new dependencies required! All controls use existing packages:
- `ioredis` (already installed) - Redis client
- `@stellar/stellar-sdk` (already installed) - Signature verification
- Node.js built-ins for crypto operations

### 2. Update Environment Variables

Add to your `.env` file (optional, sensible defaults provided):

```bash
# Invoice ceiling (default: 5000)
INVOICE_CEILING=5000

# Signature verification (production: always on, dev: opt-in)
REQUIRE_SIGNATURES=false

# Redis for rate limiting (optional, falls back to memory)
REDIS_URL=redis://localhost:6379
```

### 3. Test Locally

```bash
cd backend
npm install  # If not already done
npm test     # Run all tests including abuse-controls.test.ts
npm run dev:mvp  # Start MVP server
```

### 4. Verify Controls Work

**Test rate limiting:**
```bash
# Hit verify endpoint 11 times rapidly
for i in {1..11}; do
  curl -X POST http://localhost:3001/api/invoices/test-id/verify \
    -H "Content-Type: application/json" \
    -d '{"txHash": "test-'$i'"}' &
done
# 11th request should return 429
```

**Test body limit:**
```bash
# Send 17 KB payload
dd if=/dev/zero bs=17000 count=1 | base64 | \
curl -X POST http://localhost:3001/api/invoices \
  -H "Content-Type: application/json" \
  -d @-
# Should return 413 Payload Too Large
```

## Breaking Changes

### ⚠️ Cancel Endpoint Now Requires Authentication

**Before:**
```javascript
// ❌ This worked before (SECURITY BUG)
fetch('/api/invoices/123/cancel', {
  method: 'POST',
  body: JSON.stringify({})  // Empty body
})
```

**After (Production):**
```javascript
// Now requires a signature — one transport (the body), one message
// (`cancel:<invoiceId>`). Query params and x-seller-public-key headers are
// not accepted as transports; a value that disagrees with the body returns 400 (issue #517).
const message = `cancel:${invoiceId}`;
const signature = keypair.sign(Buffer.from(message));

fetch('/api/invoices/123/cancel', {
  method: 'POST',
  body: JSON.stringify({
    invoiceId,
    sellerPublicKey: keypair.publicKey(),
    signature: signature.toString('base64')
  })
})
```

**After (Dev/Test with REQUIRE_SIGNATURES=false):**
```javascript
// ✅ Legacy path still works in dev
fetch('/api/invoices/123/cancel', {
  method: 'POST',
  body: JSON.stringify({
    sellerPublicKey: 'GXXX...'
  })
})
```

### Migration Path for Frontend

**Option 1: Implement Signature (Recommended)**

Add to your frontend wallet integration:

```typescript
import { Keypair } from '@stellar/stellar-sdk';
import { createHash } from 'crypto';

async function cancelInvoice(invoiceId: string, keypair: Keypair) {
  const message = `cancel:${invoiceId}`;
  const signature = keypair.sign(Buffer.from(message)).toString('base64');

  const response = await fetch(`/api/invoices/${invoiceId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sellerPublicKey: keypair.publicKey(),
      signature
    })
  });

  return response.json();
}
```

**Option 2: Keep Dev Mode (Testing Only)**

For local development, keep `REQUIRE_SIGNATURES=false` in your `.env`:

```bash
# .env.local (DEV ONLY)
NODE_ENV=development
REQUIRE_SIGNATURES=false
```

Production deployments will ignore this and always require signatures.

## New Response Codes to Handle

### 401 Unauthorized
```json
{
  "success": false,
  "error": "Signature required: cancellation requires cryptographic proof of ownership",
  "code": "SIGNATURE_REQUIRED"
}
```

**Handle in frontend:**
```typescript
if (response.status === 401) {
  // Show error: "Please connect your wallet to cancel this invoice"
}
```

### 429 Too Many Requests
```json
{
  "success": false,
  "error": "Payment verification rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 60
}
```

**Handle in frontend:**
```typescript
if (response.status === 429) {
  const retryAfter = result.retryAfter || 60;
  // Show: "Too many attempts. Please wait {retryAfter} seconds."
  // Disable verify button for retryAfter seconds
}
```

### 413 Payload Too Large
```json
{
  "success": false,
  "error": "Request body exceeds maximum size of 16384 bytes",
  "code": "PAYLOAD_TOO_LARGE"
}
```

**Handle in frontend:**
```typescript
if (response.status === 413) {
  // This shouldn't happen with normal usage
  // Log to error tracking system
}
```

### 503 Service Unavailable
```json
{
  "success": false,
  "error": "Invoice storage is at capacity",
  "code": "INVOICE_STORE_FULL",
  "retryAfter": 300
}
```

**Handle in frontend:**
```typescript
if (response.status === 503 && result.code === 'INVOICE_STORE_FULL') {
  // Show: "Service is at capacity. Please try again in a few minutes."
}
```

## Backward Compatibility

### What Still Works

✅ All GET endpoints unchanged
✅ POST /invoices (create) unchanged
✅ POST /invoices/:id/verify unchanged (just rate limited)
✅ Dev mode cancel without signature (REQUIRE_SIGNATURES=false)

### What Changed

⚠️ POST /invoices/:id/cancel requires sellerPublicKey in production
⚠️ Rate limits apply to all endpoints (but limits are generous)
⚠️ 16 KB body size limit (was 100 KB framework default)

## Rollback Plan

If you need to temporarily disable controls:

```bash
# .env (EMERGENCY ONLY)
REQUIRE_SIGNATURES=false   # Allow cancel without signature
INVOICE_CEILING=999999     # Effectively disable ceiling
# Don't set REDIS_URL       # Use memory limiter (resets on restart)
```

**⚠️ WARNING**: This reverts to the insecure state. Only use for debugging.

## Production Deployment

### 1. Pre-Deployment Checklist

- [ ] Redis instance configured (recommended, not required)
- [ ] `REDIS_URL` set in production env
- [ ] `NODE_ENV=production` (automatic signature enforcement)
- [ ] `INVOICE_CEILING` reviewed for expected load
- [ ] Frontend implements signature-based cancel (or accepts 401s gracefully)
- [ ] Monitoring configured for 429/503 responses

### 2. Deployment Steps

**Zero-downtime deployment:**
1. Deploy backend with new code
2. Controls activate immediately (production mode)
3. Old cancel requests without signatures get 401
4. Frontend shows appropriate error message
5. Deploy frontend with signature support (if implementing Option 1)

**Phased rollout:**
1. Deploy backend to staging with `REQUIRE_SIGNATURES=false`
2. Test all flows
3. Enable `REQUIRE_SIGNATURES=true` in staging
4. Test cancel flow with signatures
5. Deploy to production with `NODE_ENV=production` (signatures automatic)

### 3. Post-Deployment Monitoring

**Key metrics to watch:**

```bash
# Rate limit triggers
grep "RATE_LIMIT_EXCEEDED" logs

# Signature failures
grep "SIGNATURE_REQUIRED" logs

# Invoice ceiling hits
grep "INVOICE_STORE_FULL" logs

# Oversized payloads
grep "PAYLOAD_TOO_LARGE" logs
```

**Expected behavior:**
- 429s should be rare (only during actual abuse)
- 401s spike during deployment, then drop to zero (after frontend updated)
- 413s should be zero (indicates bug if frequent)
- 503s only under heavy load (adjust INVOICE_CEILING if frequent)

## FAQ

**Q: Do I need Redis?**
A: No. Rate limiting falls back to in-memory storage. Redis is recommended for multi-instance deployments to share state across processes.

**Q: Will this break my integration tests?**
A: No. Tests run with `NODE_ENV=test` (not production), so signatures are optional. Set `REQUIRE_SIGNATURES=true` in tests to verify signature flows.

**Q: What happens if Redis goes down?**
A: Rate limiting automatically falls back to in-memory storage. Limits reset on process restart, but service stays available (fail-open design).

**Q: Can I customize rate limits?**
A: Yes. Edit `RATE_LIMITS` object in `backend/src/middleware/rate-limit.ts`. Limits are per-endpoint and configurable (capacity, window, refill).

**Q: How do I test signature verification locally?**
A: Set `REQUIRE_SIGNATURES=true` in `.env.local`. Generate signatures using Stellar SDK:

```typescript
import { Keypair } from '@stellar/stellar-sdk';
import { createHash } from 'crypto';

const keypair = Keypair.fromSecret('SXXX...');
const message = `cancel:${invoiceId}:${Date.now()}`;
const hash = createHash('sha256').update(message).digest();
const signature = keypair.sign(hash).toString('base64');
```

**Q: What if I exceed the invoice ceiling?**
A: New creates return 503 with `INVOICE_STORE_FULL`. Existing invoices still work. Ceiling resets when old invoices expire or are paid. Adjust `INVOICE_CEILING` based on your load.

**Q: Are stats/list endpoints authenticated?**
A: No. They require `sellerPublicKey` query param (seller-scoped), but no signature. This is by design: sellers need to read their own invoices without signing every request. Stats only reveal aggregate data for that seller.

## Support

**Issues:**
- File bugs with label `abuse-controls`
- Include: error response, steps to reproduce, environment (dev/prod)

**Questions:**
- Check `docs/ABUSE-CONTROLS-IMPLEMENTATION.md` for detailed design
- Review `backend/tests/abuse-controls.test.ts` for usage examples

---

**Last Updated**: 2026-09-13
**Version**: 1.0.0
