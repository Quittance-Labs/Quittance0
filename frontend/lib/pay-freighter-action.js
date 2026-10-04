/**
 * Freighter payment action helpers (issue #445).
 *
 * Isolates preflight checks and trustline error classification so PaymentButton
 * and tests share one definition of "ready to open Freighter" without changing
 * product rules (Freighter identity, optional email, existing wallet gate).
 */

const { normalizePayerDetails } = require('./payment-page-state');
const { classifyVerifyError } = require('./pay-verify-controller');

/**
 * Whether an error indicates a missing trustline for a non-native asset.
 */
function isMissingTrustlineError(error, assetCode) {
  if (!assetCode || assetCode === 'XLM') return false;
  const msg =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : typeof error === 'string'
        ? error
        : '';
  const lower = msg.toLowerCase();
  return lower.includes('trustline') || lower.includes('op_no_trust');
}

/**
 * Validate gate, invoice status, and optional payer details before Freighter.
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
 * Injected-dependency Freighter payment flow for unit tests.
 * Production still uses PaymentButton's review + builder path; this action
 * exercises the same session events (PAY_STARTED / PAY_SENT / PAY_FAILED /
 * VERIFY_*) so the status matrix stays consistent across paths.
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
        } else if (typeof dispatch === 'function') {
          dispatch({ type: 'VERIFY_FAILED', error: classification.message });
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
    const errorTitle = missingTrustline ? `${assetCode} trustline required` : 'Payment failed';
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
