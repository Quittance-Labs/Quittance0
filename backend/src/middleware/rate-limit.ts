import { Request, Response, NextFunction, RequestHandler } from 'express';
import { getEdgeControlConfig } from './edge-config';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
  code?: string;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

export class MemoryRateLimiterStore {
  private hits: Map<string, WindowEntry> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.hits.entries()) {
        if (entry.resetAt <= now) {
          this.hits.delete(key);
        }
      }
    }, 30_000);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  consume(
    key: string,
    limit: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; resetAfterSeconds: number; total: number; resetTime: number } {
    const now = Date.now();
    let entry = this.hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 1, resetAt: now + windowMs };
      this.hits.set(key, entry);
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        resetAfterSeconds: Math.ceil(windowMs / 1000),
        total: limit,
        resetTime: entry.resetAt,
      };
    }

    entry.count += 1;
    const resetAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    const allowed = entry.count <= limit;
    const remaining = Math.max(0, limit - entry.count);

    return {
      allowed,
      remaining,
      resetAfterSeconds,
      total: limit,
      resetTime: entry.resetAt,
    };
  }

  reset(): void {
    this.hits.clear();
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.hits.clear();
  }
}

export const defaultLimiterStore = new MemoryRateLimiterStore();

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Creates an Express rate limiting middleware using an in-memory sliding window.
 *
 * @param options Configuration for window duration, limit, key generator and error format
 * @param store Storage instance to maintain request hit counters
 */
export function createRateLimiter(
  options: RateLimitOptions,
  store: MemoryRateLimiterStore = defaultLimiterStore
): RequestHandler {
  const {
    windowMs,
    max,
    keyGenerator = getClientIp,
    message = 'Rate limit exceeded. Please retry later.',
    code = 'RATE_LIMIT_EXCEEDED',
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const result = store.consume(key, max, windowMs);

    res.setHeader('X-RateLimit-Limit', result.total);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

    if (!result.allowed) {
      res.setHeader('Retry-After', result.resetAfterSeconds);
      return res.status(429).json({
        success: false,
        code,
        error: message,
        retryAfter: result.resetAfterSeconds,
      });
    }

    next();
  };
}

/**
 * Creates combined short-window and long-window rate limiters for invoice creation.
 * Enforces 5 requests per 1 minute and 10 requests per 10 minutes per IP.
 */
export function createInvoiceRateLimiters(
  store: MemoryRateLimiterStore = defaultLimiterStore
): RequestHandler[] {
  const cfg = getEdgeControlConfig();
  const shortLimiter = createRateLimiter(
    {
      windowMs: cfg.rateLimitWindowMs,
      max: cfg.createPerMinute,
      keyGenerator: (req) => `create_invoice:short:${getClientIp(req)}`,
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded for invoice creation. Max ${cfg.createPerMinute} invoices per minute.`,
    },
    store
  );

  const longLimiter = createRateLimiter(
    {
      windowMs: cfg.createLongWindowMs,
      max: cfg.createPerLongWindow,
      keyGenerator: (req) => `create_invoice:long:${getClientIp(req)}`,
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded for invoice creation. Max ${cfg.createPerLongWindow} invoices per 10 minutes.`,
    },
    store
  );

  return [shortLimiter, longLimiter];
}

/**
 * Creates rate limiters for invoice verification.
 * Enforces 30 requests per minute per IP, and 10 requests per minute per invoice ID.
 */
export function createVerifyRateLimiters(
  store: MemoryRateLimiterStore = defaultLimiterStore
): RequestHandler[] {
  const cfg = getEdgeControlConfig();
  const ipLimiter = createRateLimiter(
    {
      windowMs: cfg.rateLimitWindowMs,
      max: cfg.verifyPerIp,
      keyGenerator: (req) => `verify_invoice:ip:${getClientIp(req)}`,
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded for verification. Max ${cfg.verifyPerIp} requests per minute per IP.`,
    },
    store
  );

  const invoiceLimiter = createRateLimiter(
    {
      windowMs: cfg.rateLimitWindowMs,
      max: cfg.verifyPerInvoice,
      keyGenerator: (req) => `verify_invoice:target:${req.params.id || 'unknown'}`,
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded for this invoice. Max ${cfg.verifyPerInvoice} verification requests per minute per invoice.`,
    },
    store
  );

  return [ipLimiter, invoiceLimiter];
}

/**
 * The verify handler's own per-invoice budget.
 *
 * The router already applies the same window and limit as middleware, but the
 * handler asks for this check directly so a flood against one invoice is
 * refused with the verification code the pay page already renders
 * (VERIFY_RATE_LIMIT_EXCEEDED) rather than the router's generic one. It keeps
 * its own key space so the two counters cannot charge one request twice.
 */
export function getVerifyPerInvoiceLimit(): number {
  return getEdgeControlConfig().verifyPerInvoice;
}

export function getVerifyPerInvoiceWindowMs(): number {
  return getEdgeControlConfig().rateLimitWindowMs;
}

/** @deprecated Prefer getVerifyPerInvoiceLimit() — kept for existing imports. */
export const VERIFY_PER_INVOICE_LIMIT = 10;
/** @deprecated Prefer getVerifyPerInvoiceWindowMs() — kept for existing imports. */
export const VERIFY_PER_INVOICE_WINDOW_MS = 60_000;

export function checkInvoiceVerifyLimit(
  invoiceId: string,
  store: MemoryRateLimiterStore = defaultLimiterStore
): { allowed: boolean; retryAfter: number; remaining: number } {
  const cfg = getEdgeControlConfig();
  const result = store.consume(
    'verify_handler:target:' + (invoiceId || 'unknown'),
    cfg.verifyPerInvoice,
    cfg.rateLimitWindowMs
  );
  return {
    allowed: result.allowed,
    retryAfter: result.resetAfterSeconds,
    remaining: result.remaining,
  };
}

/**
 * Creates rate limiter for invoice listing.
 * Enforces 60 requests per minute per IP.
 */
export function createGetInvoicesRateLimiter(
  store: MemoryRateLimiterStore = defaultLimiterStore
): RequestHandler {
  const cfg = getEdgeControlConfig();
  return createRateLimiter(
    {
      windowMs: cfg.rateLimitWindowMs,
      max: cfg.listPerMinute,
      keyGenerator: (req) => `list_invoices:${getClientIp(req)}`,
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded for invoice listing. Max ${cfg.listPerMinute} requests per minute.`,
    },
    store
  );
}

/**
 * Creates rate limiter for invoice cancellation.
 * Enforces 10 requests per minute per IP.
 */
export function createCancelInvoiceRateLimiter(
  store: MemoryRateLimiterStore = defaultLimiterStore
): RequestHandler {
  const cfg = getEdgeControlConfig();
  return createRateLimiter(
    {
      windowMs: cfg.rateLimitWindowMs,
      max: cfg.cancelPerMinute,
      keyGenerator: (req) => `cancel_invoice:${getClientIp(req)}`,
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded for invoice cancellation. Max ${cfg.cancelPerMinute} requests per minute.`,
    },
    store
  );
}

const inFlightVerifications = new Set<string>();

/**
 * Concurrency guard ensuring at most one in-flight verification request executes
 * per invoice ID at any given time.
 */
export function verifyConcurrencyLock(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const invoiceId = req.params.id;
    if (!invoiceId) {
      return next();
    }

    if (inFlightVerifications.has(invoiceId)) {
      const retryAfter = getEdgeControlConfig().verifyConcurrencyRetryAfterSeconds;
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        code: 'VERIFY_IN_PROGRESS',
        error: 'Verification already in progress for this invoice',
        retryAfter,
      });
    }

    inFlightVerifications.add(invoiceId);

    const cleanup = () => {
      inFlightVerifications.delete(invoiceId);
      res.removeListener('finish', cleanup);
      res.removeListener('close', cleanup);
    };

    res.once('finish', cleanup);
    res.once('close', cleanup);

    next();
  };
}

/**
 * Resets all rate limiter stores and in-flight locks. Useful for isolating test cases.
 */
export function resetRateLimiters(): void {
  defaultLimiterStore.reset();
  inFlightVerifications.clear();
}
