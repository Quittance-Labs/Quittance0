/**
 * Classifies Quittance public-API edge limit responses (issue #450).
 *
 * Rate limits (429), oversized bodies (413), the verify concurrency lock, and
 * the invoice store ceiling are retryable transport/edge conditions. They must
 * never be rendered as a payment rejection (memo / amount / destination
 * mismatch) on the pay page.
 *
 * Quittance maps upstream Horizon 429s to 503 VERIFY_UNAVAILABLE, so an HTTP
 * 429 from our API is always our own limiter / lock — not a ledger verdict.
 */

const EDGE_LIMIT_CODES = new Set([
  'RATE_LIMIT_EXCEEDED',
  'VERIFY_RATE_LIMIT_EXCEEDED',
  'VERIFY_IN_PROGRESS',
  'PAYLOAD_TOO_LARGE',
  'INVOICE_STORE_FULL',
]);

const EDGE_LIMIT_MESSAGES = Object.freeze({
  RATE_LIMIT_EXCEEDED: 'Too many requests. Please wait a moment and try again.',
  VERIFY_RATE_LIMIT_EXCEEDED: 'Too many verification attempts for this invoice',
  VERIFY_IN_PROGRESS: 'Verification is already in progress for this invoice. Please wait a moment.',
  PAYLOAD_TOO_LARGE: 'That request was too large. Please retry with a smaller payload.',
  INVOICE_STORE_FULL: 'The invoice store is temporarily full. Please try again later.',
});

const DEFAULT_EDGE_MESSAGE =
  'Too many requests or the request was too large. Wait a moment and try again.';

function edgeStatus(error) {
  if (error == null || typeof error !== 'object') return undefined;
  return error.response?.status ?? error.status ?? error.statusCode;
}

function edgeCode(error) {
  if (error == null || typeof error !== 'object') return undefined;
  const code = error.response?.data?.code ?? error.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * @param {unknown} error
 * @returns {boolean} true when the failure is an edge/rate/body limit, not a
 *   payment outcome.
 */
function isEdgeLimitError(error) {
  if (error == null) return false;
  const status = edgeStatus(error);
  const code = edgeCode(error);

  if (typeof code === 'string' && EDGE_LIMIT_CODES.has(code)) return true;
  if (status === 413 || status === 429) return true;
  return false;
}

/**
 * User-facing copy for an edge limit. Prefer the stable code; never fall through
 * to a memo/amount rejection string.
 *
 * @param {unknown} error
 * @returns {string}
 */
function edgeLimitMessage(error) {
  const code = edgeCode(error);
  if (code && EDGE_LIMIT_MESSAGES[code]) return EDGE_LIMIT_MESSAGES[code];

  const status = edgeStatus(error);
  if (status === 413) return EDGE_LIMIT_MESSAGES.PAYLOAD_TOO_LARGE;
  if (status === 429) return EDGE_LIMIT_MESSAGES.RATE_LIMIT_EXCEEDED;

  const serverText =
    (error && typeof error === 'object' && (error.response?.data?.error || error.message)) ||
    undefined;
  if (typeof serverText === 'string' && serverText.trim()) return serverText;
  return DEFAULT_EDGE_MESSAGE;
}

module.exports = {
  EDGE_LIMIT_CODES,
  EDGE_LIMIT_MESSAGES,
  DEFAULT_EDGE_MESSAGE,
  isEdgeLimitError,
  edgeLimitMessage,
};
