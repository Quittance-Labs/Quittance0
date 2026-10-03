import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { createInvoiceHandlers, InvoiceHandlerOptions } from './invoice.handlers';
import {
  createInvoiceRateLimiters,
  createVerifyRateLimiters,
  createGetInvoicesRateLimiter,
  createCancelInvoiceRateLimiter,
  verifyConcurrencyLock,
} from '../middleware/rate-limit';
import { createInvoiceCeilingMiddleware } from '../middleware/invoice-ceiling';
import { createVerifyCacheMiddleware, verificationCache } from '../middleware/verify-cache';

export interface InvoiceRouterOptions extends InvoiceHandlerOptions {
  enableRateLimiting?: boolean;
  enableConcurrencyLock?: boolean;
  enableCeilingCheck?: boolean;
  enableVerifyCache?: boolean;
  invoiceCeiling?: number;
}

/**
 * Invoice routes shared by both servers. Mount under `/api`.
 *
 * Route list is kept identical between server.ts (Postgres) and
 * server-mvp.ts (in-memory):
 *   POST   /invoices
 *   GET    /invoices/stats
 *   GET    /invoices
 *   GET    /invoices/:id
 *   GET    /invoices/:id/payment-info
 *   POST   /invoices/:id/cancel (seller authorized)
 *   POST   /invoices/:id/verify
 *   POST   /invoices/:id/simulate-payment
 *
 * Edge middleware order (issue #450) — see also middleware/edge-config.ts:
 *   App:     body size → 413 PAYLOAD_TOO_LARGE
 *   create:  ceiling → create rate limits → handler
 *   list:    list rate limit → handler
 *   cancel:  auth pre-check → cancel rate limit → handler
 *   verify:  concurrency lock → verify rate limits → replay cache → handler
 */
export function createInvoiceRouter(options: InvoiceRouterOptions): Router {
  const handlers = createInvoiceHandlers(options);
  const router = Router();

  const enableRateLimiting =
    options.enableRateLimiting ??
    (process.env.ENABLE_RATE_LIMITING === 'true' || process.env.NODE_ENV === 'production');

  const enableConcurrencyLock =
    options.enableConcurrencyLock ??
    (process.env.ENABLE_VERIFY_CONCURRENCY_LOCK === 'true' || process.env.NODE_ENV === 'production');

  const enableCeilingCheck =
    options.enableCeilingCheck ??
    (process.env.ENABLE_INVOICE_CEILING === 'true' ||
      process.env.NODE_ENV === 'production' ||
      options.invoiceCeiling !== undefined);

  // create order: ceiling (503) → short/long rate limits (429) → handler
  const createMiddlewares: RequestHandler[] = [];
  if (enableCeilingCheck && options.storage.countInvoices) {
    createMiddlewares.push(
      createInvoiceCeilingMiddleware(() => options.storage.countInvoices!(), {
        ceiling: options.invoiceCeiling,
      })
    );
  }
  if (enableRateLimiting) {
    createMiddlewares.push(...createInvoiceRateLimiters());
  }

  router.post('/invoices', ...createMiddlewares, handlers.createInvoice);
  router.get('/invoices/stats', handlers.getStats);

  const getInvoicesMiddlewares: RequestHandler[] = [];
  if (enableRateLimiting) {
    getInvoicesMiddlewares.push(createGetInvoicesRateLimiter());
  }
  router.get('/invoices', ...getInvoicesMiddlewares, handlers.getInvoices);

  router.get('/invoices/:id', handlers.getInvoice);

  // GET /invoices/:id/events - seller-scoped audit feed (issue #515)
  router.get('/invoices/:id/events', handlers.getPaymentEvents);

  // GET /invoices/:id/payment-info - Payment info (no rate limit, needed for checkout)
  router.get('/invoices/:id/payment-info', handlers.getPaymentInfo);

  const cancelMiddlewares: RequestHandler[] = [];
  const cancelAuthPreCheck: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const requireSig =
      options.requireCancelSignature ??
      (process.env.REQUIRE_CANCEL_SIGNATURE === 'true' ||
        process.env.NODE_ENV === 'production');
    if (requireSig) {
      // Body-only contract (issue #517): the handler rejects query/header
      // transports itself; this pre-check only enforces signature presence.
      const sellerKey = req.body?.sellerPublicKey;
      const signature = req.body?.signature;
      if (!sellerKey || !signature) {
        return res.status(401).json({
          success: false,
          code: 'UNAUTHORIZED',
          error: 'Cancellation requires seller proof of ownership (signature)',
        });
      }
    }
    next();
  };
  cancelMiddlewares.push(cancelAuthPreCheck);
  if (enableRateLimiting) {
    cancelMiddlewares.push(createCancelInvoiceRateLimiter());
  }
  router.post('/invoices/:id/cancel', ...cancelMiddlewares, handlers.cancelInvoice);

  const enableVerifyCache =
    options.enableVerifyCache ?? (process.env.DISABLE_VERIFY_CACHE !== 'true');

  // verify order: concurrency (429 VERIFY_IN_PROGRESS) → IP/invoice rate
  // (429 RATE_LIMIT_EXCEEDED) → replay cache → handler (own VERIFY_RATE_LIMIT)
  const verifyMiddlewares: RequestHandler[] = [];
  if (enableConcurrencyLock) {
    verifyMiddlewares.push(verifyConcurrencyLock());
  }
  if (enableRateLimiting) {
    verifyMiddlewares.push(...createVerifyRateLimiters());
  }
  // Cache is last before the handler: rate limiters still 429 a flood first,
  // and a hit then replays the recorded verdict without another Horizon call.
  // Middleware and handler share one cache instance so test overrides apply.
  if (enableVerifyCache) {
    verifyMiddlewares.push(
      createVerifyCacheMiddleware(options.verifyCache ?? verificationCache)
    );
  }
  router.post('/invoices/:id/verify', ...verifyMiddlewares, handlers.verifyPayment);

  router.post('/invoices/:id/simulate-payment', handlers.simulatePayment);

  return router;
}

export default createInvoiceRouter;
