const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PAY_STATES,
  describeVerifyError,
  getPayPageView,
  getPayPageWalletGate,
  initialPaymentState,
  isExpiredInvoice,
  isLikelyTransactionHash,
  normalizePayerDetails,
  paymentReducer,
  shouldPoll,
  shouldShowPaymentControls,
  stateForStatus,
  isBusyState,
  isResultState,
  paymentStateKind,
  describePaymentState,
} = require('../lib/payment-page-state');
const { announcementRole, announcementPoliteness } = require('../lib/a11y');

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

test('stale pending data fails closed after expiresAt', () => {
  const stale = { status: 'PENDING', expiresAt: '2000-01-01T00:00:00.000Z' };
  const now = '2026-08-30T12:00:00.000Z';

  assert.equal(isExpiredInvoice(stale, now), true);
  assert.equal(shouldShowPaymentControls(stale, undefined, now), false);
  assert.equal(initialPaymentState(stale).status, PAY_STATES.EXPIRED);
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

test('the Freighter payment gate requires a payable invoice first', () => {
  const gate = getPayPageWalletGate(paid, {
    freighterAvailable: true,
    connected: true,
    publicKey: 'G'.padEnd(56, 'A'),
    network: 'TESTNET',
  }, 'TESTNET');

  assert.equal(gate.status, 'invoice_unavailable');
  assert.equal(gate.ready, false);
});

test('the Freighter payment gate blocks disconnected wallets with shared copy', () => {
  const gate = getPayPageWalletGate(pending, {
    freighterAvailable: true,
    connected: false,
    publicKey: null,
    network: 'TESTNET',
  }, 'TESTNET');

  assert.equal(gate.status, 'disconnected');
  assert.match(gate.message, /wallet is your Quittance identity/);
});

test('the Freighter payment gate blocks wrong network sessions', () => {
  const gate = getPayPageWalletGate(pending, {
    freighterAvailable: true,
    connected: true,
    publicKey: 'G'.padEnd(56, 'A'),
    network: 'PUBLIC',
  }, 'TESTNET');

  assert.equal(gate.status, 'wrong_network');
  assert.match(gate.message, /Switch Freighter to Testnet/);
});

test('the Freighter payment gate opens for a connected wallet on the expected network', () => {
  const gate = getPayPageWalletGate(pending, {
    freighterAvailable: true,
    connected: true,
    publicKey: 'G'.padEnd(56, 'A'),
    network: 'TESTNET',
  }, 'TESTNET');

  assert.equal(gate.status, 'ready');
  assert.equal(gate.ready, true);
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

test('polling stops for a locally elapsed pending invoice', () => {
  const stale = { status: 'PENDING', expiresAt: '2000-01-01T00:00:00.000Z' };
  assert.equal(shouldPoll(idleOn(stale)), false);
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

// ------------------------------------------------- announcements (issue #289)

/*
 * The pay page's result panel is driven entirely by these four helpers: they
 * decide whether it reports itself busy, whether it takes focus, how loudly it
 * announces, and what it says. The panel's own behaviour is covered in
 * `a11y-core-pages.test.js`; what follows pins down the decisions it reads.
 */

test('the busy states are exactly the two with a request in flight', () => {
  const busy = [PAY_STATES.PAYING, PAY_STATES.VERIFYING];

  for (const status of Object.values(PAY_STATES)) {
    assert.equal(
      isBusyState({ status }),
      busy.includes(status),
      `${status} was classified incorrectly as busy or idle`
    );
  }
});

test('the result states are the three that carry an answer', () => {
  const results = [PAY_STATES.PAID, PAY_STATES.EXPIRED, PAY_STATES.ERROR];

  for (const status of Object.values(PAY_STATES)) {
    assert.equal(
      isResultState({ status }),
      results.includes(status),
      `${status} was classified incorrectly as a result`
    );
  }
});

test('an idle page is neither busy nor a result, so focus stays put', () => {
  const state = idleOn(pending);
  assert.equal(isBusyState(state), false);
  assert.equal(isResultState(state), false);
  assert.equal(describePaymentState(state), '');
});

test('only a failure is announced assertively', () => {
  for (const status of Object.values(PAY_STATES)) {
    const kind = paymentStateKind({ status });
    assert.equal(kind, status === PAY_STATES.ERROR ? 'error' : 'status');
    // The role and the politeness are one decision, not two.
    assert.equal(announcementRole(kind), status === PAY_STATES.ERROR ? 'alert' : 'status');
    assert.equal(
      announcementPoliteness(kind),
      status === PAY_STATES.ERROR ? 'assertive' : 'polite'
    );
  }
});

test('every non-idle state has an announcement that reads as prose', () => {
  for (const status of Object.values(PAY_STATES)) {
    if (status === PAY_STATES.IDLE) continue;

    const message = describePaymentState({ status, error: 'Memo mismatch' });
    assert.ok(message, `${status} has no announcement`);
    assert.ok(message.endsWith('.'), `${status} announcement is not a sentence: ${message}`);
    // A bare state name is not something worth reading aloud.
    assert.ok(
      message.split(' ').length >= 4,
      `${status} announcement is a label, not a sentence: ${message}`
    );
  }
});

test('a failure announcement carries the backend reason it was given', () => {
  const failed = paymentReducer(idleOn(pending), {
    type: 'VERIFY_FAILED',
    error: 'Memo mismatch',
  });

  assert.match(describePaymentState(failed), /Memo mismatch/);
});

test('a failure with no reason still announces the failure itself', () => {
  const failed = paymentReducer(idleOn(pending), { type: 'PAY_FAILED' });
  assert.equal(describePaymentState(failed), 'Payment could not be completed. Payment failed.');
});

test('a payment confirmed by polling announces the same result as one verified', () => {
  const polled = paymentReducer(idleOn(pending), { type: 'POLL_RESULT', invoice: paid });
  const verified = paymentReducer(idleOn(pending), { type: 'VERIFY_SUCCEEDED', invoice: paid });

  assert.equal(describePaymentState(polled), describePaymentState(verified));
  assert.equal(isResultState(polled), true);
});

test('an absent state is handled without throwing', () => {
  // The panel renders before the first dispatch on a slow load.
  assert.equal(isBusyState(undefined), false);
  assert.equal(isResultState(null), false);
  assert.equal(describePaymentState(undefined), '');
  assert.equal(paymentStateKind(null), 'status');
});
