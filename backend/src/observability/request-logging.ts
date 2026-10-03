import type { Request, Response, NextFunction } from 'express';
import { emitEvent, operationalLogContext } from './log-events';

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** Log the registered route template, never a URL containing invoice IDs. */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  res.once('finish', () => {
    const route = req.route?.path;
    emitEvent('info', 'http.request.completed', operationalLogContext(
      (req as Request & { requestId?: string }).requestId
    ), {
      method: METHODS.has(req.method) ? req.method : 'OTHER',
      route: typeof route === 'string' ? route : 'unmatched',
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
}
