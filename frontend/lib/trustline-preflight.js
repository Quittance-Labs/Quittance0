const { HORIZON_OUTAGE_MESSAGE, isHorizonOutageError } = require('./horizon-outage');

/**
 * Evaluates whether an asset code represents the native Stellar token (XLM).
 *
 * @param {string | null | undefined} assetCode - The asset code to check.
 * @returns {boolean} True if the asset is native XLM or omitted.
 */
function isNativeAsset(assetCode) {
  if (!assetCode) {
    return true;
  }
  return assetCode.trim().toUpperCase() === 'XLM';
}

/**
 * Checks if a Stellar account response contains a valid trustline for a given asset.
 *
 * @param {{ balances?: Array<{ asset_type?: string; asset_code?: string; asset_issuer?: string }> } | null | undefined} account - The account details from Horizon.
 * @param {string} assetCode - The asset code required.
 * @param {string} [assetIssuer] - The expected asset issuer account ID.
 * @returns {boolean} True if the account has a trustline for the specified asset.
 */
function hasAssetTrustline(account, assetCode, assetIssuer) {
  if (!account || !Array.isArray(account.balances)) {
    return false;
  }
  const normalizedCode = (assetCode || '').trim().toUpperCase();
  return account.balances.some((balance) => {
    if (balance.asset_type === 'native') {
      return false;
    }
    const balanceCode = (balance.asset_code || '').trim().toUpperCase();
    if (balanceCode !== normalizedCode) {
      return false;
    }
    if (assetIssuer && balance.asset_issuer && balance.asset_issuer !== assetIssuer) {
      return false;
    }
    return true;
  });
}

/**
 * Determines if an error represents an unfunded Stellar account (404 Not Found).
 *
 * @param {any} error - The caught error object.
 * @returns {boolean} True if the error indicates the account does not exist on-chain.
 */
function isNotFoundError(error) {
  if (!error) {
    return false;
  }
  if (error.status === 404 || error.statusCode === 404 || error.response?.status === 404) {
    return true;
  }
  if (error.name === 'NotFoundError') {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return message.includes('Not Found') || message.includes('not found') || message.includes('resource_missing');
}

/**
 * Pure evaluator for payer trustline eligibility.
 *
 * @param {object} params
 * @param {any} [params.account] - Account record from Horizon.
 * @param {any} [params.error] - Caught error from Horizon query.
 * @param {string} [params.assetCode] - The asset required by the invoice.
 * @param {string} [params.assetIssuer] - The issuer required by the invoice.
 * @returns {{
 *   status: 'not_required' | 'trustline_exists' | 'missing_trustline' | 'no_account' | 'outage' | 'idle',
 *   ready: boolean,
 *   canPay: boolean,
 *   isOutage?: boolean,
 *   title: string,
 *   message: string | null,
 *   action: 'none' | 'add_trustline' | 'fund' | 'retry'
 * }}
 */
function evaluatePayerTrustline({ account, error, assetCode = 'XLM', assetIssuer }) {
  const normalizedCode = (assetCode || 'XLM').trim().toUpperCase();

  if (isNativeAsset(normalizedCode)) {
    return {
      status: 'not_required',
      ready: true,
      canPay: true,
      title: 'Ready',
      message: null,
      action: 'none',
    };
  }

  if (error) {
    if (isNotFoundError(error)) {
      return {
        status: 'no_account',
        ready: false,
        canPay: false,
        title: 'Account Not Funded',
        message: `Your wallet account is not funded on Stellar. Fund your account with XLM and add a trustline for ${normalizedCode} before paying.`,
        action: 'fund',
      };
    }

    return {
      status: 'outage',
      ready: false,
      canPay: false,
      isOutage: true,
      title: 'Stellar Network Unavailable',
      message: HORIZON_OUTAGE_MESSAGE,
      action: 'retry',
    };
  }

  if (account) {
    const hasTrustline = hasAssetTrustline(account, normalizedCode, assetIssuer);
    if (hasTrustline) {
      return {
        status: 'trustline_exists',
        ready: true,
        canPay: true,
        title: `${normalizedCode} Trustline Established`,
        message: null,
        action: 'none',
      };
    }

    return {
      status: 'missing_trustline',
      ready: false,
      canPay: false,
      title: `${normalizedCode} Trustline Required`,
      message: `Your wallet does not have a trustline for ${normalizedCode}. Add the trustline in Freighter before submitting payment.`,
      action: 'add_trustline',
    };
  }

  return {
    status: 'idle',
    ready: false,
    canPay: false,
    title: 'Checking Trustline',
    message: null,
    action: 'none',
  };
}

/**
 * Asynchronously checks whether the connected payer can hold the invoice asset.
 *
 * @param {object} params
 * @param {(publicKey: string) => Promise<any>} params.loadAccountFn - Function to load account from Horizon.
 * @param {string | null | undefined} params.publicKey - The payer's public key.
 * @param {string} [params.assetCode] - The invoice asset code.
 * @param {string} [params.assetIssuer] - The invoice asset issuer.
 * @returns {Promise<ReturnType<typeof evaluatePayerTrustline>>}
 */
async function checkPayerTrustline({ loadAccountFn, publicKey, assetCode = 'XLM', assetIssuer }) {
  const normalizedCode = (assetCode || 'XLM').trim().toUpperCase();

  if (isNativeAsset(normalizedCode)) {
    return evaluatePayerTrustline({ assetCode: normalizedCode });
  }

  if (!publicKey || typeof publicKey !== 'string') {
    return {
      status: 'idle',
      ready: false,
      canPay: false,
      title: 'Wallet Not Connected',
      message: 'Connect your wallet to verify asset trustline.',
      action: 'none',
    };
  }

  try {
    const account = await loadAccountFn(publicKey);
    return evaluatePayerTrustline({ account, assetCode: normalizedCode, assetIssuer });
  } catch (error) {
    return evaluatePayerTrustline({ error, assetCode: normalizedCode, assetIssuer });
  }
}

module.exports = {
  isNativeAsset,
  hasAssetTrustline,
  isNotFoundError,
  evaluatePayerTrustline,
  checkPayerTrustline,
};
