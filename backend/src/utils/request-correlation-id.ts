// Request correlation id helper.
//
// Every invoice handler log line should include a short, unique identifier so
// that a single request can be traced across logs. This module provides a
// pure generator that returns a compact, URL-safe id suitable for log prefixing.

import { randomBytes } from 'node:crypto';

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

export default {
  createRequestId,
  REQUEST_ID_BYTES,
  REQUEST_ID_PREFIX,
};
