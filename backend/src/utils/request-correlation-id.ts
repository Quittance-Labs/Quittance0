// Request correlation ID helper.
//
// Every invoice handler log line should include a short, unique identifier so
// that a single request can be traced across logs. This module provides a
// pure generator that returns a compact, URL-safe ID suitable for log prefixing.

import { randomBytes } from 'node:crypto';

/**
 * Number of random bytes used to generate the default correlation ID.
 * 8 bytes = 64 bits of entropy, encoded to 16 hex characters.
 */
export const REQUEST_ID_BYTES = 8;

/**
 * Default prefix applied to generated correlation IDs to distinguish them
 * from invoice IDs, transaction hashes, and other identifiers in logs.
 */
export const REQUEST_ID_PREFIX = 'req';

/**
 * Generate a short, unique correlation ID for request tracing.
 *
 * The format is `<prefix>-<hex>` (by default `req-<16 hex chars>`, e.g. `req-7f3b8c9d1a2e4f50`).
 *
 * @param prefix Optional prefix string (defaults to 'req').
 * @param byteLength Optional byte count for random entropy (defaults to 8).
 * @returns A unique correlation identifier string.
 */
export function createRequestId(
  prefix: string = REQUEST_ID_PREFIX,
  byteLength: number = REQUEST_ID_BYTES
): string {
  const safeBytes =
    typeof byteLength === 'number' && Number.isInteger(byteLength) && byteLength > 0
      ? byteLength
      : REQUEST_ID_BYTES;

  const safePrefix =
    typeof prefix === 'string' && prefix.trim().length > 0
      ? prefix.trim()
      : REQUEST_ID_PREFIX;

  const hex = randomBytes(safeBytes).toString('hex');
  return `${safePrefix}-${hex}`;
}

/**
 * Check whether a value is a valid request correlation ID.
 *
 * @param id The value to validate.
 * @param prefix Optional prefix to match against (defaults to 'req').
 * @returns boolean indicating whether id matches the expected format.
 */
export function isValidRequestId(id: unknown, prefix: string = REQUEST_ID_PREFIX): boolean {
  if (typeof id !== 'string' || id.trim() === '') {
    return false;
  }
  const cleanPrefix = (prefix || REQUEST_ID_PREFIX).trim();
  const pattern = new RegExp(`^${cleanPrefix}-[0-9a-f]{16,}$`, 'i');
  return pattern.test(id.trim());
}

/**
 * Parse a correlation ID into its constituent prefix and entropy components.
 *
 * @param id The request ID string.
 * @returns Object with prefix and hex parts, or null if malformed.
 */
export function parseRequestId(id: unknown): { prefix: string; hex: string } | null {
  if (typeof id !== 'string' || !id.includes('-')) {
    return null;
  }
  const parts = id.split('-');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !/^[0-9a-fA-F]+$/.test(parts[1])) {
    return null;
  }
  return {
    prefix: parts[0],
    hex: parts[1].toLowerCase(),
  };
}

export default {
  createRequestId,
  isValidRequestId,
  parseRequestId,
  REQUEST_ID_BYTES,
  REQUEST_ID_PREFIX,
};
