import { Request, Response, NextFunction, RequestHandler } from 'express';
import { getEdgeControlConfig, EDGE_CONTROL_DEFAULTS } from './edge-config';

export const DEFAULT_INVOICE_CEILING = EDGE_CONTROL_DEFAULTS.invoiceCeiling;

export interface InvoiceCeilingOptions {
  ceiling?: number;
  retryAfterSeconds?: number;
}

/**
 * Express middleware that enforces a global invoice storage ceiling.
 * Rejects creation requests with 503 INVOICE_STORE_FULL when the ceiling is reached.
 *
 * Placed before create rate limiters (see edge-config.ts middleware order) so a
 * full store answers 503 without burning per-IP create budget.
 *
 * @param getCount Function returning the current count of invoices in storage
 * @param options Optional ceiling threshold and Retry-After delay
 */
export function createInvoiceCeilingMiddleware(
  getCount: () => Promise<number> | number,
  options?: InvoiceCeilingOptions
): RequestHandler {
  const cfg = getEdgeControlConfig();
  const ceiling = options?.ceiling ?? cfg.invoiceCeiling;
  const retryAfterSeconds =
    options?.retryAfterSeconds ?? cfg.invoiceCeilingRetryAfterSeconds;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentCount = await getCount();
      if (currentCount >= ceiling) {
        res.setHeader('Retry-After', retryAfterSeconds);
        return res.status(503).json({
          success: false,
          code: 'INVOICE_STORE_FULL',
          error: `Invoice store full: maximum invoice capacity of ${ceiling} reached`,
          retryAfter: retryAfterSeconds,
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
