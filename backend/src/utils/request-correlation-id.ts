// Request correlation id helper.
//
// Every invoice handler log line should include a short, unique identifier so
// that a single request can be traced across logs. This module provides a
// pure generator, an AsyncLocalStorage-backed accessor, and Express middleware
// that attaches a server-generated id to the request and response.

import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';

/**
 * Number of random bytes used to generate the id.
 * 8 bytes = 64 bits of entropy, base16-encoded to 16 hex characters.
 */
export const REQUEST_ID_BYTES = 8;

/**
 * Prefix applied to every generated id so it is visually distinguishable
 * from other identifiers (invoice memo, tx hash, etc.) in log output.
 */
export const REQUEST_ID_PREFIX = 'req';

const REQUEST_ID_RE = /^req-[0-9a-f]{16}$/;

interface RequestIdStore {
  requestId: string;
}

const requestIdStorage = new AsyncLocalStorage<RequestIdStore>();

/**
 * Generate a short, unique correlation id for request tracing.
 *
 * The format is `req-<16 hex chars>` (e.g. `req-a1b2c3d4e5f6a7b8`).
 *
 * - No arguments are required; the function is self-contained.
 * - The return value is always a lowercase hex string with the prefix.
 * - Collisions are astronomically unlikely (2^64 space).
 *
 * @returns A unique request id string in the format `req-<hex>`.
 */
export const createRequestId = (): string => {
  const bytes = randomBytes(REQUEST_ID_BYTES);
  const hex = bytes.toString('hex');
  return `${REQUEST_ID_PREFIX}-${hex}`;
};

/**
 * Read the active request id from AsyncLocalStorage, if any.
 */
export function getRequestId(): string | undefined {
  return requestIdStorage.getStore()?.requestId;
}

/**
 * Run `fn` with `requestId` bound in AsyncLocalStorage.
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestIdStorage.run({ requestId }, fn);
}

/**
 * Accept only our own `req-<16 hex>` shape. Anything else is rejected so a
 * caller cannot inject log-breaking text or collide traces across users.
 */
export function parseRequestIdHeader(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  return REQUEST_ID_RE.test(trimmed) ? trimmed : undefined;
}

function readInboundRequestId(req: Request): string | undefined {
  const raw =
    req.headers['x-request-id'] ??
    req.headers['x-correlation-id'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  return parseRequestIdHeader(candidate);
}

/**
 * Express middleware: bind a correlation id for the request lifetime.
 *
 * A validated inbound `X-Request-Id` / `X-Correlation-Id` that already matches
 * `req-<16 hex>` is reused so a browser-started pay flow can keep one id
 * through verify. Anything else is replaced with a fresh server id. The id is
 * always echoed as `X-Request-Id` on the response.
 */
export function requestCorrelationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = readInboundRequestId(req) ?? createRequestId();
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  runWithRequestId(requestId, () => next());
}

export default {
  createRequestId,
  getRequestId,
  runWithRequestId,
  parseRequestIdHeader,
  requestCorrelationMiddleware,
  REQUEST_ID_BYTES,
  REQUEST_ID_PREFIX,
};
