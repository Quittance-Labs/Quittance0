import { Router, RequestHandler } from 'express';
import { requestCorrelationMiddleware } from '../utils/request-correlation-id';
import { createInvoiceHandlers, InvoiceHandlerOptions } from './invoice.handlers';
import { createProofHandoffHandler } from './proof-handoff';
import {
  createInvoiceRateLimiters,
  createVerifyRateLimiters,
  createGetInvoicesRateLimiter,
  createCancelInvoiceRateLimiter,
  verifyConcurrencyLock,
  createRateLimiter,
  getClientIp,
} from '../middleware/rate-limit';
import { createInvoiceCeilingMiddleware } from '../middleware/invoice-ceiling';
import { createVerifyCacheMiddleware, verificationCache } from '../middleware/verify-cache';
import { optionalSellerSession, requireSellerSession } from '../middleware/seller-session';
import { SellerSessionService, sellerSessionsFromEnvironment } from '../services/seller-session.service';
import { createSellerAuthRouter } from './auth.routes';

export interface InvoiceRouterOptions extends InvoiceHandlerOptions {
  enableRateLimiting?: boolean;
  enableConcurrencyLock?: boolean;
  enableCeilingCheck?: boolean;
  enableVerifyCache?: boolean;
  invoiceCeiling?: number;
  /** Inject one authority for tests or an explicitly configured embedding. */
  sellerSessions?: SellerSessionService;
}

/**
 * Invoice routes shared by both servers. Mount under `/api`.
 *
 * Route list is kept identical between server.ts (Postgres) and
 * server-mvp.ts (in-memory):
 *   GET    /auth/challenge
 *   POST   /auth/session
 *   POST   /invoices
 *   GET    /invoices/stats
 *   GET    /invoices
 *   GET    /invoices/:id
 *   GET    /invoices/:id/payment-info
 *   POST   /invoices/:id/cancel (seller authorized)
 *   POST   /invoices/:id/verify
 *   POST   /invoices/:id/proof-handoff
 *   POST   /invoices/:id/simulate-payment
 *
 * Edge middleware order (issue #450) — see also middleware/edge-config.ts:
 *   App:     body size → 413 PAYLOAD_TOO_LARGE
 *   create:  seller session → ceiling → create rate limits → handler
 *   list:    seller session → list rate limit → handler
 *   cancel:  seller session → cancel rate limit → handler
 *   verify:  concurrency lock → verify rate limits → replay cache → handler
 */
export function createInvoiceRouter(options: InvoiceRouterOptions): Router {
  const handlers = createInvoiceHandlers(options);
  const router = Router();
  router.use(requestCorrelationMiddleware);

  const enableRateLimiting =
    options.enableRateLimiting ??
    (process.env.ENABLE_RATE_LIMITING === 'true' || process.env.NODE_ENV === 'production');

  // Resolve lazily so public checkout/health remain available without exposing
  // seller data when auth configuration is missing. All modes share one nonce
  // authority per router and the exact same route/middleware contract.
  let sellerSessions = options.sellerSessions;
  const sessionProvider = () => sellerSessions ??= sellerSessionsFromEnvironment();
  const sellerAuth = requireSellerSession(sessionProvider);
  router.use(createSellerAuthRouter(sessionProvider, enableRateLimiting));

  const enableConcurrencyLock =
    options.enableConcurrencyLock ??
    (process.env.ENABLE_VERIFY_CONCURRENCY_LOCK === 'true' || process.env.NODE_ENV === 'production');

  const enableCeilingCheck =
    options.enableCeilingCheck ??
    (process.env.ENABLE_INVOICE_CEILING === 'true' ||
      process.env.NODE_ENV === 'production' ||
      options.invoiceCeiling !== undefined);

  // Authenticate before admission work or any write.
  const createMiddlewares: RequestHandler[] = [sellerAuth];
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
  router.get('/invoices/stats', sellerAuth, handlers.getStats);

  const getInvoicesMiddlewares: RequestHandler[] = [sellerAuth];
  if (enableRateLimiting) {
    getInvoicesMiddlewares.push(createGetInvoicesRateLimiter());
  }
  router.get('/invoices', ...getInvoicesMiddlewares, handlers.getInvoices);

  router.get('/invoices/:id', optionalSellerSession(sessionProvider), handlers.getInvoice);

  // GET /invoices/:id/events - seller-scoped audit feed (issue #515)
  router.get('/invoices/:id/events', sellerAuth, handlers.getPaymentEvents);

  // GET /invoices/:id/payment-info - Payment info (no rate limit, needed for checkout)
  router.get('/invoices/:id/payment-info', handlers.getPaymentInfo);

  const cancelMiddlewares: RequestHandler[] = [sellerAuth];
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

  const proofHandoffMiddlewares: RequestHandler[] = [];
  if (enableRateLimiting) {
    proofHandoffMiddlewares.push(createRateLimiter({
      windowMs: 60_000,
      max: 30,
      keyGenerator: (req) => `proof-handoff:${getClientIp(req)}`,
    }));
  }
  router.post('/invoices/:id/proof-handoff', ...proofHandoffMiddlewares, createProofHandoffHandler(options.storage));

  router.post('/invoices/:id/simulate-payment', handlers.simulatePayment);

  return router;
}

export default createInvoiceRouter;
