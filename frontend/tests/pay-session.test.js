/**
 * Tests for the unified payment session state machine.
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

  const settled = initialSessionState(paidInvoice);
  assert.equal(settled.status, SESSION_STATES.PAID);
  assert.equal(settled.txHash, 'a'.repeat(64));
});

test('sessionReducer handles the full happy path: loading -> ready -> paying -> verifying -> paid', () => {
  let state = initialSessionState(null, { loading: true });
  assert.equal(state.status, SESSION_STATES.LOADING);

  state = sessionReducer(state, { type: 'INVOICE_LOADED', invoice: pendingInvoice });
  assert.equal(state.status, SESSION_STATES.READY);
  assert.equal(state.invoice?.id, 'inv_pending');

  state = sessionReducer(state, { type: 'PAY_STARTED' });
  assert.equal(state.status, SESSION_STATES.PAYING);

  const txHash = 'b'.repeat(64);
  state = sessionReducer(state, { type: 'PAY_SENT', txHash });
  assert.equal(state.status, SESSION_STATES.VERIFYING);
  assert.equal(state.txHash, txHash);

  state = sessionReducer(state, {
    type: 'VERIFY_SUCCEEDED',
    invoice: { ...pendingInvoice, status: 'PAID', paymentTxHash: txHash },
  });
  assert.equal(state.status, SESSION_STATES.PAID);
  assert.equal(state.invoice?.status, 'PAID');
});

test('sessionReducer handles rejection and reset', () => {
  let state = initialSessionState(pendingInvoice);
  assert.equal(state.status, SESSION_STATES.READY);

  state = sessionReducer(state, { type: 'PAY_STARTED' });
  assert.equal(state.status, SESSION_STATES.PAYING);

  state = sessionReducer(state, { type: 'PAY_FAILED', error: 'User rejected transaction' });
  assert.equal(state.status, SESSION_STATES.REJECTED);
  assert.equal(state.error, 'User rejected transaction');

  state = sessionReducer(state, { type: 'RESET' });
  assert.equal(state.status, SESSION_STATES.READY);
  assert.equal(state.error, null);
});

test('sessionReducer handles verify outage by returning to ready with outage indicator', () => {
  let state = initialSessionState(pendingInvoice);
  state = sessionReducer(state, { type: 'VERIFY_STARTED', txHash: 'c'.repeat(64) });
  assert.equal(state.status, SESSION_STATES.VERIFYING);

  state = sessionReducer(state, { type: 'VERIFY_UNAVAILABLE' });
  assert.equal(state.status, SESSION_STATES.READY);
  assert.equal(state.isOutage, true);
  assert.equal(state.error, null);
});

test('paid and unavailable states are strictly terminal in sessionReducer', () => {
  let paidState = initialSessionState(paidInvoice);
  assert.equal(paidState.status, SESSION_STATES.PAID);

  let attemptedReopen = sessionReducer(paidState, { type: 'PAY_STARTED' });
  assert.equal(attemptedReopen.status, SESSION_STATES.PAID);

  attemptedReopen = sessionReducer(paidState, { type: 'VERIFY_FAILED', error: 'Ignored' });
  assert.equal(attemptedReopen.status, SESSION_STATES.PAID);

  attemptedReopen = sessionReducer(paidState, { type: 'VERIFY_UNAVAILABLE' });
  assert.equal(attemptedReopen.status, SESSION_STATES.PAID);

  let unavailState = initialSessionState(expiredInvoice);
  assert.equal(unavailState.status, SESSION_STATES.UNAVAILABLE);

  attemptedReopen = sessionReducer(unavailState, { type: 'PAY_STARTED' });
  assert.equal(attemptedReopen.status, SESSION_STATES.UNAVAILABLE);

  attemptedReopen = sessionReducer(unavailState, { type: 'RESET' });
  assert.equal(attemptedReopen.status, SESSION_STATES.UNAVAILABLE);
});

test('isSessionBusy and isSessionResult accurately partition session states', () => {
  assert.equal(isSessionBusy(SESSION_STATES.PAYING), true);
  assert.equal(isSessionBusy(SESSION_STATES.VERIFYING), true);
  assert.equal(isSessionBusy(SESSION_STATES.LOADING), false);
  assert.equal(isSessionBusy(SESSION_STATES.READY), false);
  assert.equal(isSessionBusy(SESSION_STATES.PAID), false);
  assert.equal(isSessionBusy(SESSION_STATES.REJECTED), false);
  assert.equal(isSessionBusy(SESSION_STATES.UNAVAILABLE), false);

  assert.equal(isSessionResult(SESSION_STATES.PAID), true);
  assert.equal(isSessionResult(SESSION_STATES.REJECTED), true);
  assert.equal(isSessionResult(SESSION_STATES.UNAVAILABLE), true);
  assert.equal(isSessionResult(SESSION_STATES.LOADING), false);
  assert.equal(isSessionResult(SESSION_STATES.READY), false);
  assert.equal(isSessionResult(SESSION_STATES.PAYING), false);
  assert.equal(isSessionResult(SESSION_STATES.VERIFYING), false);
});

test('shouldSessionPoll polls only active pending non-terminal states', () => {
  assert.equal(shouldSessionPoll({ invoice: pendingInvoice, status: SESSION_STATES.READY }), true);
  assert.equal(shouldSessionPoll({ invoice: pendingInvoice, status: SESSION_STATES.PAYING }), true);
  assert.equal(shouldSessionPoll({ invoice: pendingInvoice, status: SESSION_STATES.VERIFYING }), true);
  assert.equal(shouldSessionPoll({ invoice: paidInvoice, status: SESSION_STATES.PAID }), false);
  assert.equal(shouldSessionPoll({ invoice: expiredInvoice, status: SESSION_STATES.UNAVAILABLE }), false);
  assert.equal(shouldSessionPoll({ invoice: null, status: SESSION_STATES.LOADING }), false);
});

test('describeSessionState provides accessible sentences for all non-ready modes', () => {
  const loadingText = describeSessionState({ status: SESSION_STATES.LOADING });
  assert.match(loadingText, /Loading invoice/);

  const payingText = describeSessionState({ status: SESSION_STATES.PAYING });
  assert.match(payingText, /Freighter/);

  const verifyingText = describeSessionState({ status: SESSION_STATES.VERIFYING });
  assert.match(verifyingText, /Stellar network/);

  const paidText = describeSessionState({ status: SESSION_STATES.PAID });
  assert.match(paidText, /Payment confirmed/);

  const unavailText = describeSessionState({ status: SESSION_STATES.UNAVAILABLE, error: 'Expired' });
  assert.match(unavailText, /unavailable/);

  const rejectedText = describeSessionState({ status: SESSION_STATES.REJECTED, error: 'Memo mismatch' });
  assert.match(rejectedText, /Payment could not be completed/);
});
