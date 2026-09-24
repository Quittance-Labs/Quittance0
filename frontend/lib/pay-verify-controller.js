/**
 * Verify / outage controller for the pay page (issue #445).
 *
 * Encapsulates hash validation, optional payer normalisation, verification
 * dispatch, and Horizon outage classification so the hook stays thin and each
 * concern is unit-testable. Rejection and outage classifiers are the existing
 * shared ones — this module only wires them through session events.
 */

const { isHorizonOutageError, HORIZON_OUTAGE_MESSAGE } = require('./horizon-outage');
const { checkTxHash, resolveVerificationError } = require('./verification');
const { isApiUnavailableError, apiErrorMessage } = require('./api-runtime');
const { normalizePayerDetails } = require('./payment-page-state');

/**
 * Validate a transaction hash with the same rules as the verify API.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function validateTxHash(txHash) {
  const checked = checkTxHash(txHash ?? '');
  if (!checked.ok) {
    return { ok: false, error: checked.error };
  }
  return { ok: true, value: checked.value };
}

/**
 * Classify a verify failure using the existing outage and rejection helpers.
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
 * Run payment verification and dispatch session events.
 * Happy-path PAID and Horizon outage retry both flow through here.
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
