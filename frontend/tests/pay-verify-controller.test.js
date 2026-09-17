/**
 * Focused tests for the pay verify and outage controller module.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateTxHash,
  classifyVerifyError,
  executePaymentVerification,
} = require('../lib/pay-verify-controller');
const { HORIZON_OUTAGE_MESSAGE } = require('../lib/horizon-outage');

const validHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

test('validateTxHash validates 64 hexadecimal characters format strictly', () => {
  assert.equal(validateTxHash('').ok, false);
  assert.equal(validateTxHash('   ').ok, false);
  assert.equal(validateTxHash('short').ok, false);
  assert.equal(validateTxHash('g'.repeat(64)).ok, false);

  const valid = validateTxHash(validHash);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value, validHash);
  }
});

test('classifyVerifyError identifies Horizon outages and preserves retryability', () => {
  const outageErrors = [
    new Error('Horizon request timed out'),
    new Error('Failed to fetch from horizon.stellar.org'),
    { response: { status: 504 } },
    { response: { status: 503 } },
  ];

  for (const err of outageErrors) {
    const classification = classifyVerifyError(err);
    assert.equal(classification.isOutage, true);
    assert.equal(classification.message, HORIZON_OUTAGE_MESSAGE);
  }
});

test('classifyVerifyError resolves canonical rejection codes', () => {
  const memoError = {
    response: {
      status: 400,
      data: { code: 'MEMO_MISMATCH', error: 'Memo mismatch from server' },
    },
  };

  const classification = classifyVerifyError(memoError);
  assert.equal(classification.isOutage, false);
  assert.equal(classification.code, 'MEMO_MISMATCH');
  assert.equal(classification.message, 'Memo mismatch');
});

test('classifyVerifyError handles API runtime unavailability', () => {
  const apiErr = {
    response: { status: 503 },
    message: 'Service Unavailable',
  };

  const classification = classifyVerifyError(apiErr);
  assert.equal(classification.isApiUnavailable || classification.isOutage, true);
});

test('executePaymentVerification rejects invalid transaction hash before making any request', async () => {
  let called = false;
  const events = [];

  const result = await executePaymentVerification({
    invoiceId: 'inv_1',
    txHash: 'invalid-hash',
    verifyFn: async () => {
      called = true;
      return {};
    },
    dispatch: (ev) => events.push(ev),
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'validation');
  assert.equal(events.length, 0);
});

test('executePaymentVerification rejects invalid payer email before making any request', async () => {
  let called = false;
  const events = [];

  const result = await executePaymentVerification({
    invoiceId: 'inv_1',
    txHash: validHash,
    payerEmail: 'not-an-email',
    verifyFn: async () => {
      called = true;
      return {};
    },
    dispatch: (ev) => events.push(ev),
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'validation');
  assert.equal(events.length, 0);
});

test('executePaymentVerification dispatches verify started and succeeded on successful verification', async () => {
  const events = [];
  const invoiceData = { id: 'inv_1', status: 'PAID', paymentTxHash: validHash };

  const result = await executePaymentVerification({
    invoiceId: 'inv_1',
    txHash: `  ${validHash}  `,
    payerName: 'Alice',
    payerEmail: 'alice@example.com',
    verifyFn: async (id, hash, payer) => {
      assert.equal(id, 'inv_1');
      assert.equal(hash, validHash);
      assert.deepEqual(payer, { payerName: 'Alice', payerEmail: 'alice@example.com' });
      return { data: invoiceData };
    },
    dispatch: (ev) => events.push(ev),
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, 'success');
  assert.deepEqual(events, [
    { type: 'VERIFY_STARTED', txHash: validHash },
    { type: 'VERIFY_SUCCEEDED', invoice: invoiceData, txHash: validHash },
  ]);
});

test('executePaymentVerification handles Horizon outage via VERIFY_UNAVAILABLE event and returns retryable', async () => {
  const events = [];
  const outageError = new Error('Horizon 504 Gateway Timeout');

  const result = await executePaymentVerification({
    invoiceId: 'inv_1',
    txHash: validHash,
    verifyFn: async () => {
      throw outageError;
    },
    dispatch: (ev) => events.push(ev),
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'outage');
  assert.equal(result.retryable, true);
  assert.equal(result.message, HORIZON_OUTAGE_MESSAGE);
  assert.deepEqual(events, [
    { type: 'VERIFY_STARTED', txHash: validHash },
    { type: 'VERIFY_UNAVAILABLE' },
  ]);
});

test('executePaymentVerification handles backend rejection via VERIFY_FAILED event', async () => {
  const events = [];
  const rejectionError = {
    response: {
      status: 400,
      data: { code: 'AMOUNT_MISMATCH', error: 'Sent amount differs from invoice' },
    },
  };

  const result = await executePaymentVerification({
    invoiceId: 'inv_1',
    txHash: validHash,
    verifyFn: async () => {
      throw rejectionError;
    },
    dispatch: (ev) => events.push(ev),
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'rejection');
  assert.equal(result.message, 'Amount mismatch');
  assert.deepEqual(events, [
    { type: 'VERIFY_STARTED', txHash: validHash },
    { type: 'VERIFY_FAILED', error: 'Amount mismatch' },
  ]);
});
