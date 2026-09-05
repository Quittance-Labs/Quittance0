import { nanoid } from 'nanoid';

export const DEFAULT_REQUEST_ID_PREFIX = 'req_';
export const REQUEST_ID_LENGTH = 12;

/**
 * Generate a short, unique correlation ID for tracing backend requests across handler logs.
 * Format: req_<nanoid> or <prefix><nanoid>
 *
 * @param prefix Optional custom prefix for the request ID. Defaults to 'req_'.
 * @param size Optional character length of the random portion. Defaults to 12.
 * @returns A unique correlation identifier string.
 */
export function createRequestId(prefix: string = DEFAULT_REQUEST_ID_PREFIX, size: number = REQUEST_ID_LENGTH): string {
  const safeSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : REQUEST_ID_LENGTH;
  const safePrefix = typeof prefix === 'string' ? prefix : DEFAULT_REQUEST_ID_PREFIX;
  return `${safePrefix}${nanoid(safeSize)}`;
}

/**
 * Validate whether a given string is a plausible correlation ID matching expected prefix and length.
 *
 * @param id Candidate request correlation ID string.
 * @param prefix Expected prefix (defaults to 'req_').
 * @returns True if the string is non-empty and starts with the prefix.
 */
export function isValidRequestId(id: unknown, prefix: string = DEFAULT_REQUEST_ID_PREFIX): boolean {
  if (typeof id !== 'string' || id.trim().length === 0) {
    return false;
  }
  const safePrefix = typeof prefix === 'string' ? prefix : DEFAULT_REQUEST_ID_PREFIX;
  if (!id.startsWith(safePrefix)) {
    return false;
  }
  return id.length > safePrefix.length;
}

/**
 * Format a log message prepended with the correlation ID tag.
 *
 * @param requestId The correlation ID.
 * @param message The log message to decorate.
 * @returns Decorated string: [requestId] message
 */
export function formatRequestLog(requestId: string, message: string): string {
  const tag = requestId ? `[${requestId}]` : '[req_unknown]';
  return `${tag} ${message}`;
}

export default {
  createRequestId,
  isValidRequestId,
  formatRequestLog,
  DEFAULT_REQUEST_ID_PREFIX,
  REQUEST_ID_LENGTH,
};
