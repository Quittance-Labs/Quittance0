// Verification result caching to prevent Horizon amplification. The verify
// route runs this middleware before the handler; a hit replays the recorded
// response, a miss falls through and the handler stores the outcome via
// cacheVerificationResult().
//
// Design: entries are keyed by (invoiceId, txHash) so a cached outcome can
// never settle a different invoice. TTL depends on what the verdict says about
// the transaction:
//   - verified PAID       -> the invoice expiry window (72h); PAID is terminal,
//                            so the replay stays correct.
//   - semantic rejections -> same window; a memo/amount/destination mismatch is
//                            a permanent fact about the transaction.
//   - TRANSACTION_NOT_FOUND -> 60s only. The hash may simply be ahead of
//                            Horizon indexing, or the lookup may have failed
//                            transiently (outage / 429 also surface here); a
//                            long negative TTL would turn a retry into a
//                            permanent block.
//   - transient-state codes -> never cached at all. A get() that finds a
//                            previously written VERIFY_UNAVAILABLE (or other
//                            NEVER_CACHE code) drops it instead of replaying.
import { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { createRedisClient } from '../config/redis';

const VERIFIED_TTL_SECONDS = 259200; // 72 hours (invoice expiry window)
const NOT_FOUND_TTL_SECONDS = 60; // short: indexing lag must not wedge a valid hash

// Codes describing a transient service state, not a fact about the
// transaction. Caching them would convert an outage into a lasting rejection.
const NEVER_CACHE_CODES: ReadonlySet<string> = new Set([
  'VERIFY_UNAVAILABLE',
  'VERIFY_RATE_LIMIT_EXCEEDED',
  'TRANSACTION_CLOSE_TIME_UNAVAILABLE',
]);

export interface CachedVerificationBody {
  success: boolean;
  code?: string;
}

interface CachedVerification {
  invoiceId: string;
  txHash: string;
  httpStatus: number;
  body: CachedVerificationBody;
  expiresAt: number;
}

/**
 * The TTL a response body earns, or null when the outcome must not be stored.
 * Exported so the caching policy can be tested without standing up Express.
 */
export function verificationCacheTtl(body: CachedVerificationBody): number | null {
  if (body.success) return VERIFIED_TTL_SECONDS;
  if (body.code === 'TRANSACTION_NOT_FOUND') return NOT_FOUND_TTL_SECONDS;
  if (body.code && NEVER_CACHE_CODES.has(body.code)) return null;
  return VERIFIED_TTL_SECONDS;
}

export class VerificationCache {
  private redis: Redis | null = null;
  private memoryCache = new Map<string, CachedVerification>();
  private connectionAttempted = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  private async getClient(): Promise<Redis | null> {
    if (!this.connectionAttempted) {
      this.connectionAttempted = true;
      try {
        this.redis = await createRedisClient();
      } catch (error) {
        console.warn('[VerifyCache] Redis unavailable, using memory fallback');
        this.redis = null;
      }
    }
    return this.redis;
  }

  private cacheKey(invoiceId: string, txHash: string): string {
    return `verify:${invoiceId}:${txHash}`;
  }

  async get(invoiceId: string, txHash: string): Promise<CachedVerification | null> {
    const key = this.cacheKey(invoiceId, txHash);

    try {
      const client = await this.getClient();
      if (client) {
        const cached = await client.get(key);
        if (cached) {
          const entry: CachedVerification = JSON.parse(cached);
          // Redis expires keys natively; expiresAt still guards entries that
          // were written with a longer TTL under an older policy.
          if (entry.expiresAt <= this.now()) {
            await client.del(key);
            return null;
          }
          // Issue #556: never replay VERIFY_UNAVAILABLE (or other transient
          // codes) even if an older build wrote them into the cache.
          if (entry.body?.code && NEVER_CACHE_CODES.has(entry.body.code)) {
            await client.del(key);
            return null;
          }
          return entry;
        }
      }
    } catch (error) {
      console.warn('[VerifyCache] Redis get failed, trying memory:', error);
    }

    // Fallback to memory
    const entry = this.memoryCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.memoryCache.delete(key);
      return null;
    }
    // Drop stale VERIFY_UNAVAILABLE (and siblings) cached before this policy.
    if (entry.body?.code && NEVER_CACHE_CODES.has(entry.body.code)) {
      this.memoryCache.delete(key);
      return null;
    }
    return entry;
  }

  async set(invoiceId: string, txHash: string, httpStatus: number, body: CachedVerificationBody): Promise<void> {
    const ttl = verificationCacheTtl(body);
    if (ttl === null) return;

    const key = this.cacheKey(invoiceId, txHash);
    const cached: CachedVerification = {
      invoiceId,
      txHash,
      httpStatus,
      body,
      expiresAt: this.now() + ttl * 1000,
    };

    try {
      const client = await this.getClient();
      if (client) {
        await client.setex(key, ttl, JSON.stringify(cached));
      }
    } catch (error) {
      console.warn('[VerifyCache] Redis set failed, using memory:', error);
    }

    // Always store in memory as backup
    this.memoryCache.set(key, cached);

    // Cleanup old memory entries
    if (this.memoryCache.size > 10000) {
      this.cleanup();
    }
  }

  /** Remove every entry. Exists for tests; production never needs to flush. */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    try {
      const client = await this.getClient();
      if (client) {
        const keys = await client.keys('verify:*');
        if (keys.length) await client.del(...keys);
      }
    } catch (error) {
      console.warn('[VerifyCache] Redis clear failed:', error);
    }
  }

  private cleanup(): void {
    const now = this.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.expiresAt <= now) {
        this.memoryCache.delete(key);
      }
    }
  }
}

export const verificationCache = new VerificationCache();

/**
 * Build the middleware around an explicit cache so tests can inject one with a
 * controllable clock. The route uses the module-level `verifyCacheMiddleware`
 * bound to the shared `verificationCache`.
 */
export function createVerifyCacheMiddleware(cache: VerificationCache): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only apply to verification endpoints
    if (!req.path.includes('/verify')) {
      return next();
    }

    const invoiceId = req.params.id;
    const txHash = req.body?.txHash;

    if (!invoiceId || !txHash) {
      return next();
    }

    cache.get(invoiceId, txHash)
      .then(cached => {
        if (!cached) {
          return next();
        }
        console.log(`[VerifyCache] Cache hit for invoice ${invoiceId}, txHash ${txHash}`);
        // Replay the exact response the first attempt produced.
        res.status(cached.httpStatus).json({ ...cached.body, cached: true });
      })
      .catch(error => {
        console.error('[VerifyCache] Check failed:', error);
        // Fail open: proceed to handler if cache check breaks
        next();
      });
  };
}

export const verifyCacheMiddleware = createVerifyCacheMiddleware(verificationCache);

/**
 * Store a verification result in the cache. Call this from the verify handler
 * with the status code and body the response is about to send.
 */
export async function cacheVerificationResult(
  invoiceId: string,
  txHash: string,
  httpStatus: number,
  body: CachedVerificationBody
): Promise<void> {
  try {
    await verificationCache.set(invoiceId, txHash, httpStatus, body);
  } catch (error) {
    console.error('[VerifyCache] Failed to cache result:', error);
    // Non-fatal: verification still completed, just won't be cached
  }
}

export default verifyCacheMiddleware;
