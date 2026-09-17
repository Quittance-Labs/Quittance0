/**
 * Freighter payment action handler.
 *
 * Encapsulates the complete wallet payment workflow: wallet connection verification,
 * network validation, transaction dispatch, trustline detection, and post-payment verification.
 */

const { normalizePayerDetails } = require('./payment-page-state');
const { classifyVerifyError } = require('./pay-verify-controller');

/**
 * Checks whether an error indicates a missing trustline for a non-native asset.
 *
 * @param {unknown} error
 * @param {string} [assetCode]
 * @returns {boolean}
 */
function isMissingTrustlineError(error, assetCode) {
  if (!assetCode || assetCode === 'XLM') return false;
  const msg = (error && typeof error === 'object' && 'message' in error ? String(error.message) : '').toLowerCase();
  return msg.includes('trustline') || msg.includes('op_no_trust');
}

/**
 * Validates preflight conditions before opening the Freighter wallet.
 *
 * @param {object} params
 * @param {object} params.walletGate
 * @param {string} [params.invoiceStatus]
 * @param {string} [params.payerName]
 * @param {string} [params.payerEmail]
 * @returns {{ ok: true, payer: object } | { ok: false, kind: string, message: string }}
 */
function validateFreighterPreflight({
  walletGate,
  invoiceStatus = 'PENDING',
  payerName,
  payerEmail,
}) {
  if (walletGate && !walletGate.ready) {
    return {
      ok: false,
      kind: 'gate_blocked',
      message: walletGate.message || 'Freighter is not ready',
    };
  }

  if (invoiceStatus !== 'PENDING') {
    const message =
      invoiceStatus === 'EXPIRED'
        ? 'This invoice has expired and cannot be paid'
        : invoiceStatus === 'CANCELLED'
          ? 'This invoice was cancelled by the seller and cannot be paid'
          : 'This invoice is not available for payment';
    return {
      ok: false,
      kind: 'invoice_unavailable',
      message,
    };
  }

  const payer = normalizePayerDetails({ payerName, payerEmail });
  if (!payer.ok) {
    return {
      ok: false,
      kind: 'invalid_payer',
      message: payer.error,
    };
  }

  return {
    ok: true,
    payer: payer.value,
  };
}

/**
 * Executes a payment attempt with Freighter and optional post-payment verification.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
async function executeFreighterPayment(options) {
  const {
    destination,
    amount,
    memo,
    assetCode = 'XLM',
    assetIssuer,
    invoiceId,
    invoiceStatus = 'PENDING',
    payerName,
    payerEmail,
    walletGate,
    checkConnectionFn,
    requestAccessFn,
    getNetworkFn,
    isWrongNetworkFn,
    sendPaymentFn,
    verifyFn,
    dispatch,
    onStart,
    onSent,
    onSuccess,
    onError,
    onWarning,
  } = options;

  const preflight = validateFreighterPreflight({
    walletGate,
    invoiceStatus,
    payerName,
    payerEmail,
  });

  if (!preflight.ok) {
    if (typeof onError === 'function') onError(preflight.message);
    return preflight;
  }

  if (typeof onStart === 'function') onStart();
  if (typeof dispatch === 'function') dispatch({ type: 'PAY_STARTED' });

  try {
    if (typeof checkConnectionFn === 'function') {
      const installed = await checkConnectionFn();
      if (!installed) {
        const message = 'Freighter is not installed';
        if (typeof dispatch === 'function') dispatch({ type: 'PAY_FAILED', error: message });
        if (typeof onError === 'function') onError(message);
        return { ok: false, kind: 'not_installed', message };
      }
    }

    if (typeof requestAccessFn === 'function') {
      const allowed = await requestAccessFn();
      if (!allowed) {
        const message = 'Freighter access was denied';
        if (typeof dispatch === 'function') dispatch({ type: 'PAY_FAILED', error: message });
        if (typeof onError === 'function') onError(message);
        return { ok: false, kind: 'access_denied', message };
      }
    }

    if (typeof getNetworkFn === 'function' && typeof isWrongNetworkFn === 'function') {
      const netDetails = await getNetworkFn();
      const networkIdentifier = netDetails?.networkPassphrase || netDetails?.network;
      if (isWrongNetworkFn(networkIdentifier)) {
        const message = 'Wallet is connected to the wrong network';
        if (typeof dispatch === 'function') dispatch({ type: 'PAY_FAILED', error: message });
        if (typeof onError === 'function') onError(message);
        return { ok: false, kind: 'wrong_network', message };
      }
    }

    const txHash = await sendPaymentFn(destination, amount, memo, assetCode, assetIssuer);
    if (typeof onSent === 'function') onSent(txHash);
    if (typeof dispatch === 'function') dispatch({ type: 'PAY_SENT', txHash });

    let verified = false;
    let verifyWarning = null;

    if (invoiceId && typeof verifyFn === 'function') {
      try {
        const verifyResult = await verifyFn(invoiceId, txHash, preflight.payer);
        verified = true;
        if (typeof dispatch === 'function') {
          dispatch({
            type: 'VERIFY_SUCCEEDED',
            invoice: verifyResult?.data ?? null,
            txHash,
          });
        }
      } catch (verifyError) {
        const classification = classifyVerifyError(verifyError);
        verifyWarning = classification.message;
        if (classification.isOutage) {
          if (typeof dispatch === 'function') dispatch({ type: 'VERIFY_UNAVAILABLE' });
        } else {
          if (typeof dispatch === 'function') {
            dispatch({ type: 'VERIFY_FAILED', error: classification.message });
          }
        }
        if (typeof onWarning === 'function') onWarning(verifyWarning);
      }
    }

    if (typeof onSuccess === 'function') onSuccess(txHash);

    return {
      ok: true,
      kind: 'success',
      txHash,
      verified,
      warning: verifyWarning,
    };
  } catch (error) {
    const missingTrustline = isMissingTrustlineError(error, assetCode);
    const errorTitle = missingTrustline
      ? `${assetCode} trustline required`
      : 'Payment failed';
    const errorDescription = missingTrustline
      ? `Please add a trustline for ${assetCode} in your wallet before paying.`
      : error?.message || 'Try again';

    if (typeof dispatch === 'function') {
      dispatch({ type: 'PAY_FAILED', error: errorTitle });
    }
    if (typeof onError === 'function') {
      onError(errorTitle, errorDescription);
    }

    return {
      ok: false,
      kind: 'payment_failed',
      message: errorTitle,
      description: errorDescription,
      missingTrustline,
    };
  }
}

module.exports = {
  isMissingTrustlineError,
  validateFreighterPreflight,
  executeFreighterPayment,
};
