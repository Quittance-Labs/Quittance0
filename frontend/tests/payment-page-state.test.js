const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PAY_STATES,
  describeVerifyError,
  getPayPageView,
  initialPaymentState,
  isExpiredInvoice,
  isLikelyTransactionHash,
  normalizePayerDetails,
  paymentReducer,
  shouldPoll,
  shouldShowPaymentControls,
  stateForStatus,
} = require('../lib/payment-page-state');

const pending = { status: 'PENDING' };
const paid = { status: 'PAID', paymentTxHash: 'a'.repeat(64) };
const expired = { status: 'EXPIRED' };

const idleOn = (invoice) => initialPaymentState(invoice);

// ---------------------------------------------------------------- UI helpers

test('identifies an expired invoice', () => {
  assert.equal(isExpiredInvoice('EXPIRED'), true);
  assert.equal(isExpiredInvoice('PENDING'), false);
});

test('hides payment controls for an expired invoice', () => {
  assert.equal(shouldShowPaymentControls('EXPIRED'), false);
});

test('keeps payment controls available for an unpaid pending invoice', () => {
  assert.equal(shouldShowPaymentControls('PENDING'), true);
  assert.equal(shouldShowPaymentControls('PENDING', 'existing-transaction'), false);
});

test('paid, pending, and expired components are mutually exclusive', () => {
  assert.deepEqual(getPayPageView(pending), {
    expired: false,
    paid: false,
    showPaymentControls: true,
    showProof: false,
    showMonitor: true,
  });
  assert.equal(getPayPageView(paid).showProof, true);
  assert.equal(getPayPageView(expired).showPaymentControls, false);
});

// -------------------------------------------------------------- initial state

test('an invoice that is already settled starts in its terminal state', () => {
  assert.equal(initialPaymentState(paid).status, PAY_STATES.PAID);
  assert.equal(initialPaymentState(expired).status, PAY_STATES.EXPIRED);
  assert.equal(initialPaymentState(pending).status, PAY_STATES.IDLE);
  assert.equal(initialPaymentState(null).status, PAY_STATES.IDLE);
});

test('the initial state carries an already recorded transaction hash', () => {
  assert.equal(initialPaymentState(paid).txHash, 'a'.repeat(64));
  assert.equal(initialPaymentState(pending).txHash, null);
});

test('stateForStatus only forces a state for settled invoices', () => {
  assert.equal(stateForStatus('PAID'), PAY_STATES.PAID);
  assert.equal(stateForStatus('EXPIRED'), PAY_STATES.EXPIRED);
  assert.equal(stateForStatus('PENDING'), null);
  assert.equal(stateForStatus('CANCELLED'), null);
});

// ------------------------------------------------------------- happy paths

test('the Freighter path walks idle -> paying -> verifying -> paid', () => {
  let state = idleOn(pending);
  assert.equal(state.status, PAY_STATES.IDLE);

  state = paymentReducer(state, { type: 'PAY_STARTED' });
  assert.equal(state.status, PAY_STATES.PAYING);

  state = paymentReducer(state, { type: 'PAY_SENT', txHash: 'b'.repeat(64) });
  assert.equal(state.status, PAY_STATES.VERIFYING);
  assert.equal(state.txHash, 'b'.repeat(64));

  state = paymentReducer(state, { type: 'VERIFY_SUCCEEDED', invoice: paid });
  assert.equal(state.status, PAY_STATES.PAID);
  assert.equal(state.error, null);
});

test('the manual path walks idle -> verifying -> paid', () => {
  let state = idleOn(pending);

  state = paymentReducer(state, { type: 'VERIFY_STARTED' });
  assert.equal(state.status, PAY_STATES.VERIFYING);

  state = paymentReducer(state, { type: 'VERIFY_SUCCEEDED', invoice: paid });
  assert.equal(state.status, PAY_STATES.PAID);
});

test('polling that observes a payment settles the page', () => {
  let state = idleOn(pending);
  state = paymentReducer(state, { type: 'POLL_RESULT', invoice: paid });

  assert.equal(state.status, PAY_STATES.PAID);
  assert.equal(state.invoice.status, 'PAID');
});

// ---------------------------------------------------------------- rejections

test('a rejected verification surfaces the reason and stays recoverable', () => {
  let state = paymentReducer(idleOn(pending), { type: 'VERIFY_STARTED' });
  state = paymentReducer(state, { type: 'VERIFY_FAILED', error: 'Memo mismatch' });

  assert.equal(state.status, PAY_STATES.ERROR);
  assert.equal(state.error, 'Memo mismatch');

  // The payer can correct the hash and try again.
  state = paymentReducer(state, { type: 'VERIFY_STARTED' });
  assert.equal(state.status, PAY_STATES.VERIFYING);
  assert.equal(state.error, null);
});

test('a failed payment attempt returns to an actionable state', () => {
  let state = paymentReducer(idleOn(pending), { type: 'PAY_STARTED' });
  state = paymentReducer(state, { type: 'PAY_FAILED', error: 'Freighter access was denied' });

  assert.equal(state.status, PAY_STATES.ERROR);
  assert.equal(state.error, 'Freighter access was denied');

  state = paymentReducer(state, { type: 'RESET' });
  assert.equal(state.status, PAY_STATES.IDLE);
  assert.equal(state.error, null);
});

test('an error carries a fallback message when none is supplied', () => {
  const failed = paymentReducer(idleOn(pending), { type: 'VERIFY_FAILED' });
  assert.match(failed.error, /Verification failed/);
});

// -------------------------------------------------- duplicate verify / terminal

test('paid is terminal: no local event moves the page back out of it', () => {
  const settled = paymentReducer(idleOn(pending), { type: 'VERIFY_SUCCEEDED', invoice: paid });

  for (const event of [
    { type: 'VERIFY_STARTED' },
    { type: 'PAY_STARTED' },
    { type: 'PAY_SENT', txHash: 'c'.repeat(64) },
    { type: 'VERIFY_FAILED', error: 'Invoice has already been paid' },
    { type: 'RESET' },
  ]) {
    assert.equal(
      paymentReducer(settled, event).status,
      PAY_STATES.PAID,
      `${event.type} must not unsettle a paid invoice`
    );
  }
});

test('a duplicate verification cannot turn a paid invoice into an error', () => {
  const settled = paymentReducer(idleOn(pending), { type: 'VERIFY_SUCCEEDED', invoice: paid });
  const afterDuplicate = paymentReducer(settled, {
    type: 'VERIFY_FAILED',
    error: 'Invoice has already been paid',
  });

  assert.equal(afterDuplicate.status, PAY_STATES.PAID);
  assert.equal(afterDuplicate.error, null);
});

test('expired is terminal and refuses new payment attempts', () => {
  const gone = paymentReducer(idleOn(pending), { type: 'POLL_RESULT', invoice: expired });

  assert.equal(gone.status, PAY_STATES.EXPIRED);
  assert.equal(paymentReducer(gone, { type: 'PAY_STARTED' }).status, PAY_STATES.EXPIRED);
  assert.equal(paymentReducer(gone, { type: 'VERIFY_STARTED' }).status, PAY_STATES.EXPIRED);
});

test('the ledger overrides an attempt in flight', () => {
  // Someone else paid the invoice while this payer was still in the wallet.
  const paying = paymentReducer(idleOn(pending), { type: 'PAY_STARTED' });
  const settled = paymentReducer(paying, { type: 'POLL_RESULT', invoice: paid });

  assert.equal(settled.status, PAY_STATES.PAID);
});

test('a still-pending poll does not interrupt an attempt in flight', () => {
  const paying = paymentReducer(idleOn(pending), { type: 'PAY_STARTED' });
  const stillPaying = paymentReducer(paying, { type: 'POLL_RESULT', invoice: pending });

  assert.equal(stillPaying.status, PAY_STATES.PAYING, 'a pending poll must not cancel the attempt');
});

test('an unknown event leaves the state untouched by reference', () => {
  const state = idleOn(pending);
  assert.equal(paymentReducer(state, { type: 'NOT_A_REAL_EVENT' }), state);
  assert.equal(paymentReducer(state, undefined), state);
});

// -------------------------------------------------------------------- polling

test('polling runs only while the answer is still unknown', () => {
  assert.equal(shouldPoll(idleOn(pending)), true);
  assert.equal(shouldPoll(idleOn(paid)), false);
  assert.equal(shouldPoll(idleOn(expired)), false);
  assert.equal(shouldPoll(idleOn(null)), false);
});

test('polling stops the moment the invoice settles', () => {
  const settled = paymentReducer(idleOn(pending), { type: 'POLL_RESULT', invoice: paid });
  assert.equal(shouldPoll(settled), false);
});

test('polling continues while a payment is being verified', () => {
  // The verify request can fail while the payment still lands on the ledger,
  // so the page must keep watching until the backend agrees.
  const verifying = paymentReducer(idleOn(pending), { type: 'VERIFY_STARTED' });
  assert.equal(shouldPoll(verifying), true);
});

// ------------------------------------------------------------ payer details

test('payer details are trimmed and empty values become undefined', () => {
  const result = normalizePayerDetails({ payerName: '  Ada  ', payerEmail: '  ' });

  assert.equal(result.ok, true);
  assert.equal(result.value.payerName, 'Ada');
  assert.equal(result.value.payerEmail, undefined);
});

test('an omitted payer is valid', () => {
  assert.equal(normalizePayerDetails().ok, true);
  assert.equal(normalizePayerDetails({}).ok, true);
});

test('an invalid payer email is rejected with a message', () => {
  const result = normalizePayerDetails({ payerEmail: 'not-an-email' });

  assert.equal(result.ok, false);
  assert.match(result.error, /valid payer email/i);
});

test('a valid payer email passes through trimmed', () => {
  const result = normalizePayerDetails({ payerEmail: ' ada@example.com ' });

  assert.equal(result.ok, true);
  assert.equal(result.value.payerEmail, 'ada@example.com');
});

// ------------------------------------------------------------- error mapping

test('the backend message is preferred over the transport message', () => {
  const error = {
    message: 'Request failed with status code 400',
    response: { data: { error: 'Memo mismatch' } },
  };

  assert.equal(describeVerifyError(error), 'Memo mismatch');
});

test('the transport message is used when the backend said nothing', () => {
  assert.equal(describeVerifyError({ message: 'Network Error' }), 'Network Error');
});

test('a fallback is used when there is nothing to report', () => {
  assert.equal(describeVerifyError(undefined), 'Verification failed');
  assert.equal(describeVerifyError({}, 'Try again'), 'Try again');
});

// ---------------------------------------------------------------- hash shape

test('a transaction hash is 64 hexadecimal characters', () => {
  assert.equal(isLikelyTransactionHash('a'.repeat(64)), true);
  assert.equal(isLikelyTransactionHash(` ${'A'.repeat(64)} `), true);
  assert.equal(isLikelyTransactionHash('a'.repeat(63)), false);
  assert.equal(isLikelyTransactionHash('z'.repeat(64)), false);
  assert.equal(isLikelyTransactionHash(''), false);
  assert.equal(isLikelyTransactionHash(undefined), false);
});
