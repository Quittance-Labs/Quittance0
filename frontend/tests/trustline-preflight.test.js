const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isNativeAsset,
  hasAssetTrustline,
  isNotFoundError,
  evaluatePayerTrustline,
  checkPayerTrustline,
} = require('../lib/trustline-preflight');
const { HORIZON_OUTAGE_MESSAGE } = require('../lib/horizon-outage');
const { messageForCode } = require('../lib/verification');
const {
  USDC_ISSUER,
  PAYER_PUBLIC_KEY,
  noAccountError,
  horizonOutageError,
  noTrustlineAccount,
  trustlineAccount,
  xlmInvoice,
  usdcInvoice,
} = require('./fixtures/trustline-preflight.fixture');

test('identifies native XLM asset', () => {
  assert.equal(isNativeAsset('XLM'), true);
  assert.equal(isNativeAsset('xlm'), true);
  assert.equal(isNativeAsset(null), true);
  assert.equal(isNativeAsset(undefined), true);
  assert.equal(isNativeAsset(''), true);
  assert.equal(isNativeAsset('USDC'), false);
  assert.equal(isNativeAsset('USDT'), false);
});

test('identifies asset trustline presence on account balances', () => {
  assert.equal(hasAssetTrustline(trustlineAccount, 'USDC', USDC_ISSUER), true);
  assert.equal(hasAssetTrustline(noTrustlineAccount, 'USDC', USDC_ISSUER), false);
  assert.equal(hasAssetTrustline(trustlineAccount, 'USDT', USDC_ISSUER), false);
  assert.equal(hasAssetTrustline(trustlineAccount, 'USDC', 'GOTHERISSUER'), false);
  assert.equal(hasAssetTrustline(null, 'USDC', USDC_ISSUER), false);
  assert.equal(hasAssetTrustline({ balances: [] }, 'USDC', USDC_ISSUER), false);
});

test('evaluates XLM invoice as not requiring trustline check', () => {
  const result = evaluatePayerTrustline({
    assetCode: xlmInvoice.assetCode,
  });

  assert.equal(result.status, 'not_required');
  assert.equal(result.ready, true);
  assert.equal(result.canPay, true);
  assert.equal(result.action, 'none');
});

test('evaluates no account error as unfunded account state', () => {
  const result = evaluatePayerTrustline({
    error: noAccountError,
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
  });

  assert.equal(result.status, 'no_account');
  assert.equal(result.ready, false);
  assert.equal(result.canPay, false);
  assert.equal(result.action, 'fund');
  assert.match(result.message, /not funded on Stellar/i);
  assert.match(result.message, /add a trustline for USDC/i);
});

test('evaluates missing trustline on funded account', () => {
  const result = evaluatePayerTrustline({
    account: noTrustlineAccount,
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
  });

  assert.equal(result.status, 'missing_trustline');
  assert.equal(result.ready, false);
  assert.equal(result.canPay, false);
  assert.equal(result.action, 'add_trustline');
  assert.match(result.message, /does not have a trustline for USDC/i);
  assert.match(result.message, /Add the trustline in Freighter/i);
});

test('evaluates established trustline on funded account', () => {
  const result = evaluatePayerTrustline({
    account: trustlineAccount,
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
  });

  assert.equal(result.status, 'trustline_exists');
  assert.equal(result.ready, true);
  assert.equal(result.canPay, true);
  assert.equal(result.action, 'none');
});

test('evaluates Horizon network outage as retryable error without fake passing', () => {
  const result = evaluatePayerTrustline({
    error: horizonOutageError,
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
  });

  assert.equal(result.status, 'outage');
  assert.equal(result.ready, false);
  assert.equal(result.canPay, false);
  assert.equal(result.isOutage, true);
  assert.equal(result.action, 'retry');
  assert.equal(result.message, HORIZON_OUTAGE_MESSAGE);
});

test('checkPayerTrustline skips network lookup for XLM invoice', async () => {
  let lookupCalled = false;
  const loadAccountFn = async () => {
    lookupCalled = true;
    return noTrustlineAccount;
  };

  const result = await checkPayerTrustline({
    loadAccountFn,
    publicKey: PAYER_PUBLIC_KEY,
    assetCode: 'XLM',
  });

  assert.equal(lookupCalled, false);
  assert.equal(result.status, 'not_required');
  assert.equal(result.canPay, true);
});

test('checkPayerTrustline blocks submit when payer lacks trustline', async () => {
  const loadAccountFn = async () => noTrustlineAccount;

  const result = await checkPayerTrustline({
    loadAccountFn,
    publicKey: PAYER_PUBLIC_KEY,
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
  });

  assert.equal(result.status, 'missing_trustline');
  assert.equal(result.canPay, false);
  assert.equal(result.ready, false);
});

test('checkPayerTrustline permits submit when payer has trustline', async () => {
  const loadAccountFn = async () => trustlineAccount;

  const result = await checkPayerTrustline({
    loadAccountFn,
    publicKey: PAYER_PUBLIC_KEY,
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
  });

  assert.equal(result.status, 'trustline_exists');
  assert.equal(result.canPay, true);
  assert.equal(result.ready, true);
});

test('checkPayerTrustline treats Horizon failure as outage and never passes as fake trustline', async () => {
  const loadAccountFn = async () => {
    throw horizonOutageError;
  };

  const result = await checkPayerTrustline({
    loadAccountFn,
    publicKey: PAYER_PUBLIC_KEY,
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
  });

  assert.equal(result.status, 'outage');
  assert.equal(result.canPay, false);
  assert.equal(result.isOutage, true);
  assert.equal(result.message, HORIZON_OUTAGE_MESSAGE);
});

test('trustline messages are distinct from verify rejection codes and network mismatch', () => {
  const missingResult = evaluatePayerTrustline({
    account: noTrustlineAccount,
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
  });

  const verifyRejectionCodes = [
    'MEMO_MISMATCH',
    'AMOUNT_MISMATCH',
    'DESTINATION_MISMATCH',
    'EXPIRED',
    'NETWORK_MISMATCH',
  ];

  for (const code of verifyRejectionCodes) {
    const rejectionMsg = messageForCode(code);
    assert.notEqual(missingResult.message, rejectionMsg);
    assert.equal(missingResult.message.includes(rejectionMsg), false);
  }
});
