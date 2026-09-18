/**
 * Tells a Horizon/network outage apart from a verification rejection.
 *
 * The pay page raised the same "verification failed" state for both, so a slow
 * or unreachable Horizon looked to the payer like their payment had been
 * rejected. Rejections carry a machine code (memo, amount or destination
 * mismatch); outages arrive as fetch failures, timeouts, or 5xx/429 answers.
 */

const { isApiUnavailableError } = require('./api-runtime.js');

const HORIZON_OUTAGE_MESSAGE =
  'Network problem reaching Stellar. Nothing was rejected - retry in a moment.';

const NETWORK_PATTERNS = [
  /fetch failed/i,
  /failed to fetch/i,
  /network\s?error/i,
  /load failed/i,
  /network request failed/i,
  /econnrefused|econnreset|etimedout|enotfound|eai_again/i,
  /timed?\s?out/i,
  /stellar horizon is temporarily unreachable/i,
];

function matchesNetworkText(value) {
  return (
    typeof value === 'string' &&
    NETWORK_PATTERNS.some((pattern) => pattern.test(value))
  );
}

/**
 * @param {unknown} error
 * @returns {boolean} true when the failure is a transport/availability problem
 * rather than a verification rejection.
 */
function isHorizonOutageError(error) {
  if (error == null) return false;

  if (isApiUnavailableError(error)) return true;
  if (Boolean(error.retryable)) return true;
  if (matchesNetworkText(error)) return true;

  const status = error.response?.status ?? error.status ?? error.statusCode;
  if (typeof status === 'number' && (status >= 500 || status === 429 || status === 413)) {
    return true;
  }

  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;

  return matchesNetworkText(error.message);
}

module.exports = { HORIZON_OUTAGE_MESSAGE, isHorizonOutageError };
