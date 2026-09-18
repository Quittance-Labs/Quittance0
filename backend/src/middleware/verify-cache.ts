// Verification result caching to prevent Horizon amplification. Once a txHash
// is verified for an invoice, the result is cached and subsequent verify calls
// for the same (invoice, txHash) pair skip the Horizon round trip.
//
// Design: Cache hits return the existing invoice state. Cache misses proceed to
// the handler. The handler is responsible for storing the result after a
// successful Horizon lookup via cacheVerificationResult().
//
// TTL is set to the invoice expiry window (typically 72 hours) plus a buffer.
import { Request, Response, NextFunction } from 'express';
import type { Redis } from 'ioredis';
import { createRedisClient } from '../config/redis';

const CACHE_TTL_SECONDS = 259200; // 72 hours (invoice expiry window)

interface CachedVerification {
  invoiceId: string;
  txHash: string;
  result: 'verified' | 'rejected';
  code?: string;
  cachedAt: number;
}

class VerificationCache {
  private redis: Redis | null = null;
  private memoryCache = new Map<string, CachedVerification>();
  private connectionAttempted = false;

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
          return JSON.parse(cached);
        }
      }
    } catch (error) {
      console.warn('[VerifyCache] Redis get failed, trying memory:', error);
    }

    // Fallback to memory
    return this.memoryCache.get(key) || null;
  }

  async set(invoiceId: string, txHash: string, result: 'verified' | 'rejected', code?: string): Promise<void> {
    const key = this.cacheKey(invoiceId, txHash);
    const cached: CachedVerification = {
      invoiceId,
      txHash,
      result,
      code,
      cachedAt: Date.now(),
    };

    try {
      const client = await this.getClient();
      if (client) {
        await client.setex(key, CACHE_TTL_SECONDS, JSON.stringify(cached));
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

  private cleanup(): void {
    const cutoff = Date.now() - CACHE_TTL_SECONDS * 1000;
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.cachedAt < cutoff) {
        this.memoryCache.delete(key);
      }
    }
  }

  reset(): void {
    this.memoryCache.clear();
  }
}

const cache = new VerificationCache();

/**
 * Clear the verification cache state.
 */
export function resetVerificationCache(): void {
  cache.reset();
}

/**
 * Middleware that checks if a verification request has already been processed.
 * If found in cache, returns the cached response immediately. Otherwise, allows
 * the request to proceed to the handler.
 */
export function verifyCacheMiddleware(req: Request, res: Response, next: NextFunction): void {
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
      if (cached) {
        console.log(`[VerifyCache] Cache hit for invoice ${invoiceId}, txHash ${txHash}`);
        
        if (cached.result === 'verified') {
          // Return success without hitting Horizon
          res.status(200).json({
            success: true,
            message: 'Payment already verified (cached)',
            cached: true,
          });
        } else {
          // Return previous rejection
          res.status(400).json({
            success: false,
            error: 'Verification previously failed',
            code: cached.code || 'VERIFICATION_FAILED',
            cached: true,
          });
        }
      } else {
        // Cache miss, proceed to handler
        next();
      }
    })
    .catch(error => {
      console.error('[VerifyCache] Check failed:', error);
      // Fail open: proceed to handler if cache check breaks
      next();
    });
}

/**
 * Store a verification result in the cache. Call this from the verify handler
 * after a successful Horizon lookup.
 */
export async function cacheVerificationResult(
  invoiceId: string,
  txHash: string,
  result: 'verified' | 'rejected',
  code?: string
): Promise<void> {
  try {
    await cache.set(invoiceId, txHash, result, code);
  } catch (error) {
    console.error('[VerifyCache] Failed to cache result:', error);
    // Non-fatal: verification still succeeded, just won't be cached
  }
}

export default verifyCacheMiddleware;
