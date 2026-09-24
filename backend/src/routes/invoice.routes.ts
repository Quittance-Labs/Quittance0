import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { requestCorrelationMiddleware } from '../utils/request-correlation-id';
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
 */
export function createInvoiceRouter(options: InvoiceRouterOptions): Router {
  const handlers = createInvoiceHandlers(options);
  const router = Router();
  router.use(requestCorrelationMiddleware);

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

  const verifyMiddlewares: RequestHandler[] = [];
  if (enableConcurrencyLock) {
    verifyMiddlewares.push(verifyConcurrencyLock());
  }
  if (enableRateLimiting) {
    verifyMiddlewares.push(...createVerifyRateLimiters());
  }
  // Last in the chain: rate limiters still 429 a flood first, and a cache hit
  // then replays the recorded verdict without another Horizon round trip. The
  // middleware and the handler share one cache instance so a test override is
  // honoured by both.
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
