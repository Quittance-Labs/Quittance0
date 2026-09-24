const test = require('node:test');
const assert = require('node:assert/strict');

const {
  accountHasTrustline,
  classifyAccountLookupError,
  classifyTrustlinePreflight,
  trustlinePreflightMessage,
  looksLikeVerifyRejection,
  VERIFY_REJECTION_MARKERS,
} = require('../lib/trustline-preflight.ts');

const {
  USDC_ISSUER,
  noTrustlineAccount,
  trustlineExistsAccount,
  wrongIssuerAccount,
  xlmInvoice,
  usdcInvoice,
  notFoundError,
  horizonOutageError,
} = require('./fixtures/trustline-preflight.fixture.js');

const fundedWithUsdc = trustlineExistsAccount;
const fundedWithoutUsdc = noTrustlineAccount;

test('native XLM never needs a trustline check', () => {
  assert.deepEqual(
    classifyTrustlinePreflight({ assetCode: 'XLM' }),
    { ok: true, code: 'NATIVE_ASSET' }
  );
  assert.equal(accountHasTrustline(fundedWithoutUsdc, 'XLM', ''), false);
});

test('an account holding the asset passes the preflight', () => {
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    account: fundedWithUsdc,
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
});

test('a funded account without the trustline is blocked as MISSING_TRUSTLINE', () => {
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    account: fundedWithoutUsdc,
    networkLabel: 'testnet',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MISSING_TRUSTLINE');
  assert.equal(result.retryable, undefined);
  assert.match(result.message, /USDC trustline/);
  assert.match(result.message, /testnet/);
});

test('a same-code trustline under a different issuer does not count', () => {
  const otherIssuer = { balances: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'G' + 'E'.repeat(55) }] };
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    account: otherIssuer,
  });
  assert.equal(result.code, 'MISSING_TRUSTLINE');
});

test('a missing asset issuer can never prove the trustline', () => {
  const result = classifyTrustlinePreflight({ assetCode: 'USDC', account: fundedWithUsdc });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MISSING_TRUSTLINE');
});

test('a 404 account lookup means unfunded, not trustline-verified', () => {
  const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } });
  assert.equal(classifyAccountLookupError(notFound), 'ACCOUNT_NOT_FOUND');
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    error: notFound,
    networkLabel: 'testnet',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACCOUNT_NOT_FOUND');
  assert.equal(result.retryable, false);
  assert.match(result.message, /not funded/);
});

test('a Horizon outage is retryable and never a fake pass', () => {
  const outage = Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' });
  assert.equal(classifyAccountLookupError(outage), 'HORIZON_UNAVAILABLE');
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    error: outage,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HORIZON_UNAVAILABLE');
  assert.equal(result.retryable, true);
  assert.match(result.message, /try again/i);
});

test('a 5xx Horizon response classifies as outage', () => {
  const err = Object.assign(new Error('Service Unavailable'), { response: { status: 503 } });
  assert.equal(classifyAccountLookupError(err), 'HORIZON_UNAVAILABLE');
});

test('no account object and no error means unfunded', () => {
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    account: null,
  });
  assert.equal(result.code, 'ACCOUNT_NOT_FOUND');
});

test('asset codes normalize before comparing', () => {
  const result = classifyTrustlinePreflight({
    assetCode: 'usdc',
    assetIssuer: USDC_ISSUER,
    account: fundedWithUsdc,
  });
  assert.equal(result.ok, true);
});

test('trustline copy names the asset and the network', () => {
  const message = trustlinePreflightMessage('MISSING_TRUSTLINE', 'USDC', 'testnet');
  assert.match(message, /USDC/);
  assert.match(message, /testnet/);
  assert.match(message, /XLM invoice/);
});


test('fixture: XLM invoice skips trustline regardless of account', () => {
  const result = classifyTrustlinePreflight({
    assetCode: xlmInvoice.assetCode,
    assetIssuer: xlmInvoice.assetIssuer,
    account: noTrustlineAccount,
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'NATIVE_ASSET');
});

test('fixture: no account (unfunded) blocks USDC before Freighter', () => {
  const result = classifyTrustlinePreflight({
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
    error: notFoundError,
    networkLabel: 'testnet',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACCOUNT_NOT_FOUND');
  assert.equal(looksLikeVerifyRejection(result.message), false);
});

test('fixture: no trustline blocks USDC before Freighter', () => {
  const result = classifyTrustlinePreflight({
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
    account: noTrustlineAccount,
    networkLabel: 'testnet',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MISSING_TRUSTLINE');
  assert.match(result.message, /Add the USDC trustline/i);
  assert.equal(looksLikeVerifyRejection(result.message), false);
});

test('fixture: trustline exists allows USDC preflight', () => {
  const result = classifyTrustlinePreflight({
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
    account: trustlineExistsAccount,
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
});

test('fixture: Horizon outage is retryable, never a fake trustline pass', () => {
  const result = classifyTrustlinePreflight({
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
    error: horizonOutageError,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HORIZON_UNAVAILABLE');
  assert.equal(result.retryable, true);
  assert.equal(looksLikeVerifyRejection(result.message), false);
});

test('trustline copy is never a verify memo/amount/destination rejection', () => {
  for (const code of ['MISSING_TRUSTLINE', 'ACCOUNT_NOT_FOUND', 'HORIZON_UNAVAILABLE']) {
    const message = trustlinePreflightMessage(code, 'USDC', 'testnet');
    assert.equal(looksLikeVerifyRejection(message), false);
    for (const marker of VERIFY_REJECTION_MARKERS) {
      assert.equal(
        message.toLowerCase().includes(marker.toLowerCase()),
        false,
        `${code} message must not contain ${marker}`
      );
    }
  }
});

test('wrong-issuer USDC fixture still counts as missing trustline', () => {
  const result = classifyTrustlinePreflight({
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
    account: wrongIssuerAccount,
  });
  assert.equal(result.code, 'MISSING_TRUSTLINE');
});
