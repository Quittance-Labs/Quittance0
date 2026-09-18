const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HORIZON_OUTAGE_MESSAGE,
  isHorizonOutageError,
} = require('../lib/horizon-outage.js');
const {
  PAY_STATES,
  initialPaymentState,
  paymentReducer,
} = require('../lib/payment-page-state');

test('treats transport and Horizon availability failures as outages', () => {
  assert.equal(isHorizonOutageError(new Error('fetch failed')), true);
  assert.equal(isHorizonOutageError({ name: 'AbortError', message: 'aborted' }), true);
  assert.equal(isHorizonOutageError({ name: 'TimeoutError', message: 'timeout' }), true);
  assert.equal(isHorizonOutageError({ response: { status: 503 } }), true);
  assert.equal(isHorizonOutageError({ response: { status: 500 } }), true);
  assert.equal(isHorizonOutageError({ response: { status: 429 } }), true);
  assert.equal(isHorizonOutageError({ response: { status: 413 } }), true);
  assert.equal(isHorizonOutageError({ retryable: true }), true);
  assert.equal(isHorizonOutageError({ code: 'API_UNREACHABLE' }), true);
  assert.equal(
    isHorizonOutageError(new Error('Stellar Horizon is temporarily unreachable.')),
    true,
  );
  assert.equal(isHorizonOutageError('NetworkError when attempting to fetch resource.'), true);
  assert.equal(isHorizonOutageError(new Error('connect ECONNREFUSED 127.0.0.1:8000')), true);
});

test('keeps verification rejections out of the outage path', () => {
  assert.equal(
    isHorizonOutageError({ response: { status: 400, data: { code: 'MEMO_MISMATCH' } } }),
    false,
  );
  assert.equal(
    isHorizonOutageError({ response: { status: 404, data: { code: 'TX_NOT_FOUND' } } }),
    false,
  );
  assert.equal(
    isHorizonOutageError({ response: { status: 422, data: { code: 'AMOUNT_MISMATCH' } } }),
    false,
  );
  assert.equal(isHorizonOutageError(null), false);
  assert.equal(isHorizonOutageError(undefined), false);
});

test('an outage returns the session to idle instead of failing it', () => {
  const verifying = {
    ...initialPaymentState({ status: 'PENDING' }),
    status: PAY_STATES.VERIFYING,
  };

  const afterOutage = paymentReducer(verifying, { type: 'VERIFY_UNAVAILABLE' });
  assert.equal(afterOutage.status, PAY_STATES.IDLE);
  assert.equal(afterOutage.error, null);

  const afterReject = paymentReducer(verifying, {
    type: 'VERIFY_FAILED',
    error: 'Memo mismatch',
  });
  assert.equal(afterReject.status, PAY_STATES.ERROR);
  assert.equal(afterReject.error, 'Memo mismatch');
});

test('a terminal payment state is not reopened by an outage', () => {
  const paid = {
    ...initialPaymentState({ status: 'PAID', paymentTxHash: 'a'.repeat(64) }),
    status: PAY_STATES.PAID,
  };

  const next = paymentReducer(paid, { type: 'VERIFY_UNAVAILABLE' });
  assert.equal(next.status, PAY_STATES.PAID);
  assert.equal(HORIZON_OUTAGE_MESSAGE.includes('retry'), true);
});
