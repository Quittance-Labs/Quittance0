/**
 * Tells a Horizon/network outage apart from a verification rejection.
 *
 * One policy from the shared Horizon client through the pay page (issue #556):
 * timeout, 429, and connection failures surface as VERIFY_UNAVAILABLE. The pay
 * page shows one retryable alert with that canonical message — never a second
 * string in the button, the verify panel, or a toast alongside the alert.
 */

const { isApiUnavailableError } = require('./api-runtime.js');
const { messageForCode } = require('./verification.js');
const {
  HORIZON_OUTAGE_RETRY_WAIT_SECONDS,
} = require('../../shared/horizon-retry.ts');

/** Canonical payer-facing outage copy — same code the API returns as 503. */
const HORIZON_OUTAGE_MESSAGE =
  messageForCode('VERIFY_UNAVAILABLE') ||
  `Verification is temporarily unavailable; try again within ${HORIZON_OUTAGE_RETRY_WAIT_SECONDS} seconds`;

const NETWORK_PATTERNS = [
  /fetch failed/i,
  /failed to fetch/i,
  /network\s?error/i,
  /load failed/i,
  /network request failed/i,
  /econnrefused|econnreset|etimedout|enotfound|eai_again/i,
  /timed?\s?out/i,
  /stellar horizon is temporarily unreachable/i,
  /verification is temporarily unavailable/i,
];

function matchesNetworkText(value) {
  return (
    typeof value === 'string' &&
    NETWORK_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function responseCode(error) {
  return (
    error?.response?.data?.code ||
    error?.code ||
    error?.data?.code ||
    undefined
  );
}

/**
 * @param {unknown} error
 * @returns {boolean} true when the failure is a transport/availability problem
 * rather than a verification rejection (memo/amount/destination mismatch).
 */
function isHorizonOutageError(error) {
  if (error == null) return false;

  if (responseCode(error) === 'VERIFY_UNAVAILABLE') return true;
  if (isApiUnavailableError(error)) return true;
  if (matchesNetworkText(error)) return true;

  const status = error.response?.status ?? error.status ?? error.statusCode;
  if (typeof status === 'number' && (status >= 500 || status === 429)) {
    if (responseCode(error) === 'VERIFY_RATE_LIMIT_EXCEEDED') return false;
    return true;
  }

  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;

  return matchesNetworkText(error.message);
}

module.exports = {
  HORIZON_OUTAGE_MESSAGE,
  HORIZON_OUTAGE_RETRY_WAIT_SECONDS,
  isHorizonOutageError,
};
