/**
 * Verify and outage controller for payment transactions.
 *
 * Encapsulates input validation, ledger hash verification, canonical error
 * classification, and Horizon outage handling.
 */

const { isHorizonOutageError, HORIZON_OUTAGE_MESSAGE } = require('./horizon-outage');
const { resolveVerificationError } = require('./verification');
const { isApiUnavailableError, apiErrorMessage } = require('./api-runtime');
const { normalizePayerDetails, isLikelyTransactionHash } = require('./payment-page-state');

/**
 * Validates a transaction hash string format.
 *
 * @param {string} txHash
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function validateTxHash(txHash) {
  const trimmed = (txHash ?? '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Transaction hash is required' };
  }
  if (!isLikelyTransactionHash(trimmed)) {
    return { ok: false, error: 'Enter a valid 64-character transaction hash' };
  }
  return { ok: true, value: trimmed };
}

/**
 * Classifies an error received during transaction verification.
 *
 * @param {unknown} error
 * @returns {{ isOutage: boolean, isApiUnavailable: boolean, message: string, code?: string }}
 */
function classifyVerifyError(error) {
  if (isHorizonOutageError(error)) {
    return {
      isOutage: true,
      isApiUnavailable: false,
      message: HORIZON_OUTAGE_MESSAGE,
    };
  }

  const isApiUnavailable = isApiUnavailableError(error);
  const code = error?.response?.data?.code;
  const message = resolveVerificationError(
    error,
    isApiUnavailable ? apiErrorMessage(error) : 'Verification failed'
  );

  return {
    isOutage: false,
    isApiUnavailable,
    message,
    code,
  };
}

/**
 * Executes payment verification against the API with classification and event dispatching.
 *
 * @param {object} params
 * @param {string} params.invoiceId
 * @param {string} params.txHash
 * @param {string} [params.payerName]
 * @param {string} [params.payerEmail]
 * @param {Function} params.verifyFn
 * @param {Function} [params.dispatch]
 * @returns {Promise<object>}
 */
async function executePaymentVerification({
  invoiceId,
  txHash,
  payerName,
  payerEmail,
  verifyFn,
  dispatch,
}) {
  const hashResult = validateTxHash(txHash);
  if (!hashResult.ok) {
    return { ok: false, kind: 'validation', error: hashResult.error };
  }

  const payerResult = normalizePayerDetails({ payerName, payerEmail });
  if (!payerResult.ok) {
    return { ok: false, kind: 'validation', error: payerResult.error };
  }

  if (typeof dispatch === 'function') {
    dispatch({ type: 'VERIFY_STARTED', txHash: hashResult.value });
  }

  try {
    const result = await verifyFn(invoiceId, hashResult.value, payerResult.value);
    const invoiceData = result?.data ?? null;

    if (typeof dispatch === 'function') {
      dispatch({
        type: 'VERIFY_SUCCEEDED',
        invoice: invoiceData,
        txHash: hashResult.value,
      });
    }

    return {
      ok: true,
      kind: 'success',
      invoice: invoiceData,
      txHash: hashResult.value,
    };
  } catch (error) {
    const classification = classifyVerifyError(error);

    if (classification.isOutage) {
      if (typeof dispatch === 'function') {
        dispatch({ type: 'VERIFY_UNAVAILABLE' });
      }
      return {
        ok: false,
        kind: 'outage',
        message: classification.message,
        retryable: true,
      };
    }

    if (typeof dispatch === 'function') {
      dispatch({ type: 'VERIFY_FAILED', error: classification.message });
    }

    return {
      ok: false,
      kind: 'rejection',
      message: classification.message,
      code: classification.code,
      isApiUnavailable: classification.isApiUnavailable,
      retryable: true,
    };
  }
}

module.exports = {
  validateTxHash,
  classifyVerifyError,
  executePaymentVerification,
};
