/**
 * Tests for the unified payment session state model (issue #445).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SESSION_STATES,
  TERMINAL_SESSION_STATUSES,
  isTerminalSessionStatus,
  deriveSessionStatus,
  initialSessionState,
  sessionReducer,
  isSessionBusy,
  isSessionResult,
  shouldSessionPoll,
  describeSessionState,
} = require('../lib/payment-session');

const pendingInvoice = {
  id: 'inv_pending',
  amount: 10,
  assetCode: 'USDC',
  memo: 'MEMO123',
  status: 'PENDING',
  sellerPublicKey: 'GAAAAAAA',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

const paidInvoice = {
  ...pendingInvoice,
  id: 'inv_paid',
  status: 'PAID',
  paymentTxHash: 'a'.repeat(64),
};

const expiredInvoice = {
  ...pendingInvoice,
  id: 'inv_expired',
  status: 'EXPIRED',
};

const cancelledInvoice = {
  ...pendingInvoice,
  id: 'inv_cancelled',
  status: 'CANCELLED',
};

test('deriveSessionStatus produces all 7 session modes deterministically', () => {
  assert.equal(
    deriveSessionStatus({ loading: true, invoice: null }),
    SESSION_STATES.LOADING
  );
  assert.equal(
    deriveSessionStatus({ loading: false, invoice: null, loadError: 'Network error' }),
    SESSION_STATES.UNAVAILABLE
  );
  assert.equal(
    deriveSessionStatus({ loading: false, invoice: pendingInvoice, paymentStatus: 'ready' }),
    SESSION_STATES.READY
  );
  assert.equal(
    deriveSessionStatus({ loading: false, invoice: pendingInvoice, paymentStatus: 'idle' }),
    SESSION_STATES.READY
  );
  assert.equal(
    deriveSessionStatus({ loading: false, invoice: pendingInvoice, paymentStatus: 'paying' }),
    SESSION_STATES.PAYING
  );
  assert.equal(
    deriveSessionStatus({ loading: false, invoice: pendingInvoice, paymentStatus: 'verifying' }),
    SESSION_STATES.VERIFYING
  );
  assert.equal(
    deriveSessionStatus({ loading: false, invoice: paidInvoice }),
    SESSION_STATES.PAID
  );
  assert.equal(
    deriveSessionStatus({ loading: false, invoice: pendingInvoice, paymentStatus: 'rejected' }),
    SESSION_STATES.REJECTED
  );
  assert.equal(
    deriveSessionStatus({ loading: false, invoice: pendingInvoice, paymentStatus: 'error' }),
    SESSION_STATES.REJECTED
  );
  assert.equal(
    deriveSessionStatus({ loading: false, invoice: expiredInvoice }),
    SESSION_STATES.UNAVAILABLE
  );
  assert.equal(
    deriveSessionStatus({ loading: false, invoice: cancelledInvoice }),
    SESSION_STATES.UNAVAILABLE
  );
});

test('initialSessionState honors initial parameters', () => {
  const loading = initialSessionState(null, { loading: true });
  assert.equal(loading.status, SESSION_STATES.LOADING);
  assert.equal(loading.invoice, null);

  const ready = initialSessionState(pendingInvoice);
  assert.equal(ready.status, SESSION_STATES.READY);
  assert.equal(ready.invoice.id, 'inv_pending');

  const paid = initialSessionState(paidInvoice);
  assert.equal(paid.status, SESSION_STATES.PAID);
  assert.equal(paid.txHash, paidInvoice.paymentTxHash);
});

test('sessionReducer happy-path reaches PAID and survives RESET', () => {
  let state = initialSessionState(pendingInvoice);
  state = sessionReducer(state, { type: 'PAY_STARTED' });
  assert.equal(state.status, SESSION_STATES.PAYING);
  state = sessionReducer(state, { type: 'PAY_SENT', txHash: 'b'.repeat(64) });
  assert.equal(state.status, SESSION_STATES.VERIFYING);
  state = sessionReducer(state, {
    type: 'VERIFY_SUCCEEDED',
    invoice: paidInvoice,
  });
  assert.equal(state.status, SESSION_STATES.PAID);
  const afterReset = sessionReducer(state, { type: 'RESET' });
  assert.equal(afterReset.status, SESSION_STATES.PAID);
});

test('sessionReducer Horizon outage returns to READY with isOutage and is retryable', () => {
  let state = initialSessionState(pendingInvoice);
  state = sessionReducer(state, { type: 'VERIFY_STARTED', txHash: 'c'.repeat(64) });
  assert.equal(state.status, SESSION_STATES.VERIFYING);
  state = sessionReducer(state, { type: 'VERIFY_UNAVAILABLE' });
  assert.equal(state.status, SESSION_STATES.READY);
  assert.equal(state.isOutage, true);
  assert.equal(state.error, null);
});

test('sessionReducer maps pay/verify failures to REJECTED', () => {
  let state = initialSessionState(pendingInvoice);
  state = sessionReducer(state, { type: 'PAY_FAILED', error: 'User rejected' });
  assert.equal(state.status, SESSION_STATES.REJECTED);
  assert.equal(state.error, 'User rejected');

  state = initialSessionState(pendingInvoice);
  state = sessionReducer(state, { type: 'VERIFY_FAILED', error: 'Memo mismatch' });
  assert.equal(state.status, SESSION_STATES.REJECTED);
  assert.equal(state.error, 'Memo mismatch');
});

test('terminal helpers and busy/result partitioning cover every mode', () => {
  assert.deepEqual(
    [...TERMINAL_SESSION_STATUSES].sort(),
    [SESSION_STATES.PAID, SESSION_STATES.UNAVAILABLE].sort()
  );
  assert.equal(isTerminalSessionStatus(SESSION_STATES.PAID), true);
  assert.equal(isTerminalSessionStatus(SESSION_STATES.UNAVAILABLE), true);
  assert.equal(isTerminalSessionStatus(SESSION_STATES.READY), false);

  assert.equal(isSessionBusy(SESSION_STATES.PAYING), true);
  assert.equal(isSessionBusy(SESSION_STATES.VERIFYING), true);
  assert.equal(isSessionBusy(SESSION_STATES.READY), false);

  assert.equal(isSessionResult(SESSION_STATES.PAID), true);
  assert.equal(isSessionResult(SESSION_STATES.REJECTED), true);
  assert.equal(isSessionResult(SESSION_STATES.UNAVAILABLE), true);
  assert.equal(isSessionResult(SESSION_STATES.READY), false);
});

test('shouldSessionPoll stays active only for pending ready sessions', () => {
  const ready = initialSessionState(pendingInvoice);
  assert.equal(shouldSessionPoll(ready), true);

  const paid = initialSessionState(paidInvoice);
  assert.equal(shouldSessionPoll(paid), false);

  const expired = initialSessionState(expiredInvoice);
  assert.equal(shouldSessionPoll(expired), false);
});

test('describeSessionState returns assistive prose for each mode', () => {
  assert.match(describeSessionState({ status: SESSION_STATES.LOADING }), /Loading/);
  assert.match(describeSessionState({ status: SESSION_STATES.PAYING }), /Freighter/);
  assert.match(describeSessionState({ status: SESSION_STATES.VERIFYING }), /Verifying/);
  assert.match(describeSessionState({ status: SESSION_STATES.PAID }), /confirmed/);
  assert.match(
    describeSessionState({ status: SESSION_STATES.REJECTED, error: 'Memo mismatch' }),
    /Memo mismatch/
  );
  assert.match(describeSessionState({ status: SESSION_STATES.UNAVAILABLE }), /unavailable/);
  assert.equal(describeSessionState({ status: SESSION_STATES.READY }), '');
});
