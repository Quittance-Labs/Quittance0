import { Request, Response, NextFunction } from 'express';
import { createRequestId } from '../utils/request-correlation-id';

export const REQUEST_ID_HEADER = 'X-Request-Id';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Returns the correlation ID attached to the request, or creates a new one.
 */
export function getRequestId(req: Request): string {
  return req.requestId || createRequestId();
}

/**
 * Express middleware to attach a unique server-generated request correlation ID.
 * Sets req.requestId and the X-Request-Id response header.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.requestId) {
    req.requestId = createRequestId();
  }
  res.setHeader(REQUEST_ID_HEADER, req.requestId);
  next();
}

export default correlationMiddleware;
