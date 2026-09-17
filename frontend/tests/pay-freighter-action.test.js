/**
 * Focused tests for the Freighter payment action module.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateFreighterPreflight,
  isMissingTrustlineError,
  executeFreighterPayment,
} = require('../lib/pay-freighter-action');

test('validateFreighterPreflight blocks actions when wallet gate is not ready', () => {
  const gateBlocked = validateFreighterPreflight({
    walletGate: { ready: false, message: 'Connect Freighter to pay' },
    invoiceStatus: 'PENDING',
  });

  assert.equal(gateBlocked.ok, false);
  assert.equal(gateBlocked.kind, 'gate_blocked');
  assert.equal(gateBlocked.message, 'Connect Freighter to pay');
});

test('validateFreighterPreflight blocks non-pending invoices', () => {
  const expired = validateFreighterPreflight({
    walletGate: { ready: true },
    invoiceStatus: 'EXPIRED',
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.kind, 'invoice_unavailable');
  assert.match(expired.message, /expired/);

  const cancelled = validateFreighterPreflight({
    walletGate: { ready: true },
    invoiceStatus: 'CANCELLED',
  });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.kind, 'invoice_unavailable');
  assert.match(cancelled.message, /cancelled/);
});

test('validateFreighterPreflight validates payer email format', () => {
  const invalidEmail = validateFreighterPreflight({
    walletGate: { ready: true },
    invoiceStatus: 'PENDING',
    payerEmail: 'invalid-email',
  });
  assert.equal(invalidEmail.ok, false);
  assert.equal(invalidEmail.kind, 'invalid_payer');

  const valid = validateFreighterPreflight({
    walletGate: { ready: true },
    invoiceStatus: 'PENDING',
    payerName: ' Bob ',
    payerEmail: ' bob@example.com ',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.deepEqual(valid.payer, { payerName: 'Bob', payerEmail: 'bob@example.com' });
  }
});

test('isMissingTrustlineError accurately detects trustline op errors for custom assets', () => {
  assert.equal(isMissingTrustlineError(new Error('op_no_trust'), 'XLM'), false);
  assert.equal(isMissingTrustlineError(new Error('op_no_trust'), 'USDC'), true);
  assert.equal(isMissingTrustlineError(new Error('Missing trustline for asset'), 'USDC'), true);
  assert.equal(isMissingTrustlineError(new Error('Insufficient balance'), 'USDC'), false);
});

test('executeFreighterPayment handles uninstalled wallet', async () => {
  const events = [];

  const result = await executeFreighterPayment({
    destination: 'GAAAA',
    amount: '10.00',
    memo: 'MEMO',
    walletGate: { ready: true },
    checkConnectionFn: async () => false,
    sendPaymentFn: async () => 'hash',
    dispatch: (ev) => events.push(ev),
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'not_installed');
  assert.deepEqual(events, [{ type: 'PAY_STARTED' }, { type: 'PAY_FAILED', error: 'Freighter is not installed' }]);
});

test('executeFreighterPayment handles access denied', async () => {
  const events = [];

  const result = await executeFreighterPayment({
    destination: 'GAAAA',
    amount: '10.00',
    memo: 'MEMO',
    walletGate: { ready: true },
    checkConnectionFn: async () => true,
    requestAccessFn: async () => false,
    sendPaymentFn: async () => 'hash',
    dispatch: (ev) => events.push(ev),
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'access_denied');
  assert.deepEqual(events, [{ type: 'PAY_STARTED' }, { type: 'PAY_FAILED', error: 'Freighter access was denied' }]);
});

test('executeFreighterPayment handles network mismatch', async () => {
  const events = [];

  const result = await executeFreighterPayment({
    destination: 'GAAAA',
    amount: '10.00',
    memo: 'MEMO',
    walletGate: { ready: true },
    checkConnectionFn: async () => true,
    requestAccessFn: async () => true,
    getNetworkFn: async () => ({ network: 'PUBLIC' }),
    isWrongNetworkFn: (net) => net === 'PUBLIC',
    sendPaymentFn: async () => 'hash',
    dispatch: (ev) => events.push(ev),
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'wrong_network');
  assert.deepEqual(events, [{ type: 'PAY_STARTED' }, { type: 'PAY_FAILED', error: 'Wallet is connected to the wrong network' }]);
});

test('executeFreighterPayment happy path completes payment and verification', async () => {
  const events = [];
  const validHash = 'c'.repeat(64);
  let verifiedInvoiceId = null;

  const result = await executeFreighterPayment({
    destination: 'GAAAA',
    amount: '10.00',
    memo: 'MEMO',
    assetCode: 'USDC',
    invoiceId: 'inv_123',
    invoiceStatus: 'PENDING',
    payerName: 'Charlie',
    walletGate: { ready: true },
    checkConnectionFn: async () => true,
    requestAccessFn: async () => true,
    getNetworkFn: async () => ({ network: 'TESTNET' }),
    isWrongNetworkFn: () => false,
    sendPaymentFn: async (dest, amt, memo, asset) => {
      assert.equal(dest, 'GAAAA');
      assert.equal(amt, '10.00');
      assert.equal(memo, 'MEMO');
      assert.equal(asset, 'USDC');
      return validHash;
    },
    verifyFn: async (id, hash, payer) => {
      verifiedInvoiceId = id;
      assert.equal(hash, validHash);
      assert.deepEqual(payer, { payerName: 'Charlie', payerEmail: undefined });
      return { data: { id, status: 'PAID', paymentTxHash: hash } };
    },
    dispatch: (ev) => events.push(ev),
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, 'success');
  assert.equal(result.txHash, validHash);
  assert.equal(result.verified, true);
  assert.equal(verifiedInvoiceId, 'inv_123');
  assert.deepEqual(events, [
    { type: 'PAY_STARTED' },
    { type: 'PAY_SENT', txHash: validHash },
    {
      type: 'VERIFY_SUCCEEDED',
      invoice: { id: 'inv_123', status: 'PAID', paymentTxHash: validHash },
      txHash: validHash,
    },
  ]);
});

test('executeFreighterPayment detects trustline errors during payment submission', async () => {
  const events = [];

  const result = await executeFreighterPayment({
    destination: 'GAAAA',
    amount: '10.00',
    memo: 'MEMO',
    assetCode: 'USDC',
    walletGate: { ready: true },
    checkConnectionFn: async () => true,
    requestAccessFn: async () => true,
    getNetworkFn: async () => ({ network: 'TESTNET' }),
    isWrongNetworkFn: () => false,
    sendPaymentFn: async () => {
      throw new Error('Transaction failed: op_no_trust on destination');
    },
    dispatch: (ev) => events.push(ev),
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'payment_failed');
  assert.equal(result.missingTrustline, true);
  assert.match(result.message, /trustline required/);
  assert.deepEqual(events, [
    { type: 'PAY_STARTED' },
    { type: 'PAY_FAILED', error: 'USDC trustline required' },
  ]);
});
