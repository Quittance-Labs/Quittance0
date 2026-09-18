import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';

export const REQUEST_ID_BYTES = 8;
export const REQUEST_ID_PREFIX = 'req';

export interface RequestStore {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

/**
 * Retrieve the active correlation ID from async storage.
 */
export function getRequestCorrelationId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

/**
 * Run a synchronous or asynchronous callback within a correlation context.
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn);
}

/**
 * Generate a short, unique correlation id for request tracing.
 * Format is req-<16 hex chars>.
 */
export const createRequestId = (): string => {
  const bytes = randomBytes(REQUEST_ID_BYTES);
  const hex = bytes.toString('hex');
  return `${REQUEST_ID_PREFIX}-${hex}`;
};

/**
 * Validate an inbound correlation identifier to prevent log injection.
 * Accepts alphanumeric strings, hyphens, and underscores up to 64 characters.
 */
export function validateCorrelationId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) {
    return null;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Express middleware to extract or generate a correlation ID, echo it on
 * response headers (X-Request-Id and X-Correlation-Id), and bind it to
 * the request object and AsyncLocalStorage context.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const headers = (req && req.headers) || {};
  const rawHeader =
    headers['x-correlation-id'] ||
    headers['x-request-id'] ||
    (req as any)?.id ||
    (req as any)?.requestId;

  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const validated = validateCorrelationId(headerValue);
  const requestId = validated || createRequestId();

  (req as any).id = requestId;
  (req as any).requestId = requestId;
  (req as any).correlationId = requestId;

  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Correlation-Id', requestId);

  runWithRequestId(requestId, () => {
    next();
  });
}

export default {
  createRequestId,
  validateCorrelationId,
  getRequestCorrelationId,
  runWithRequestId,
  correlationMiddleware,
  requestContext,
  REQUEST_ID_BYTES,
  REQUEST_ID_PREFIX,
};
