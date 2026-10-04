/**
 * Exhaustive status matrix for the pay-page control helpers.
 *
 * `payment-page-state.test.js` covers the headline cases; this file walks every
 * invoice status the backend can return, including ones the pay page has never
 * been asserted against. The two helpers decide whether the page offers pay and
 * manual-verify at all, so a regression here silently re-enables payment on an
 * invoice that must not accept one.
 *
 * Session modes (issue #445) are partitioned below so every pay-page state
 * maps to exactly one of: loading, ready, paying, verifying, paid, rejected,
 * unavailable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isExpiredInvoice,
  shouldShowPaymentControls,
  getPayPageView,
} = require('../lib/payment-page-state');
const { statusText, statusBadgeLabel, statusAnnouncement } = require('../lib/a11y');

/** Every status the backend's invoice model can produce. */
const ALL_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'];

test('only EXPIRED is treated as expired', () => {
  for (const status of ALL_STATUSES) {
    assert.equal(
      isExpiredInvoice(status),
      status === 'EXPIRED',
      `${status} was classified incorrectly`
    );
  }
});

test('a PENDING status with elapsed expiresAt is treated as expired', () => {
  const invoice = { status: 'PENDING', expiresAt: '2000-01-01T00:00:00.000Z' };
  assert.equal(isExpiredInvoice(invoice), true);
  assert.equal(shouldShowPaymentControls(invoice), false);
});

test('an unknown or missing status is not treated as expired', () => {
  assert.equal(isExpiredInvoice(undefined), false);
  assert.equal(isExpiredInvoice(null), false);
  assert.equal(isExpiredInvoice(''), false);
  assert.equal(isExpiredInvoice('SOMETHING_NEW'), false);
});

test('payment controls are offered for exactly one status', () => {
  const offered = ALL_STATUSES.filter((status) => shouldShowPaymentControls(status));

  assert.deepEqual(
    offered,
    ['PENDING'],
    'only a pending invoice may still be paid'
  );
});

test('a recorded transaction hash withdraws the controls on every status', () => {
  for (const status of ALL_STATUSES) {
    assert.equal(
      shouldShowPaymentControls(status, 'b3a1f0c9'),
      false,
      `${status} still offered payment despite an existing transaction`
    );
  }
});

test('an empty transaction hash does not count as already paid', () => {
  // A falsy hash is "no payment recorded yet", not "payment in progress".
  assert.equal(shouldShowPaymentControls('PENDING', ''), true);
  assert.equal(shouldShowPaymentControls('PENDING', undefined), true);
  assert.equal(shouldShowPaymentControls('PENDING', null), true);
});

test('an unknown status never offers payment controls', () => {
  // Statuses added on the backend must fail closed, not open.
  assert.equal(shouldShowPaymentControls('SOMETHING_NEW'), false);
  assert.equal(shouldShowPaymentControls(undefined), false);
});

test('component visibility is derived consistently for every invoice status', () => {
  const matrix = Object.fromEntries(
    ALL_STATUSES.map((status) => [status, getPayPageView({ status, paymentTxHash: status === 'PAID' ? 'hash' : undefined })])
  );

  assert.equal(matrix.PENDING.showPaymentControls, true);
  assert.equal(matrix.PENDING.showMonitor, true);
  assert.equal(matrix.PAID.showProof, true);
  assert.equal(matrix.EXPIRED.expired, true);
  assert.equal(matrix.CANCELLED.cancelled, true);
  assert.equal(matrix.CANCELLED.showPaymentControls, false);
});

test('pay page view handles multi-asset invoices (XLM, USDC) correctly', () => {
  const usdcInvoice = {
    status: 'PENDING',
    assetCode: 'USDC',
    amount: 50,
  };
  const view = getPayPageView(usdcInvoice);
  assert.equal(view.showPaymentControls, true);
  assert.equal(view.expired, false);
});

/*
 * Text equivalents (issue #289).
 *
 * The same statuses drive three colour-only indicators — the pay page's dot,
 * the dashboard card's pill and the detail page's icon. The matrix above proves
 * each status routes to the right controls; these prove each one also has words
 * behind it, so status never depends on seeing a colour.
 */

test('every status has a distinct, non-empty text equivalent', () => {
  const labels = ALL_STATUSES.map((status) => statusText(status).label);

  for (const [index, status] of ALL_STATUSES.entries()) {
    assert.ok(labels[index], `${status} has no label`);
  }

  assert.equal(
    new Set(labels).size,
    ALL_STATUSES.length,
    'two statuses share a label, so they are indistinguishable without colour'
  );
});

test('every status description is a sentence a live region can read', () => {
  for (const status of ALL_STATUSES) {
    const { description } = statusText(status);
    assert.ok(description.length > 10, `${status} description is too terse to be read aloud`);
    assert.ok(description.endsWith('.'), `${status} description is not a sentence`);
  }
});

test('a status badge label names the status it stands for', () => {
  for (const status of ALL_STATUSES) {
    assert.equal(statusBadgeLabel(status), `Invoice status: ${statusText(status).label}`);
  }
});

test('a status announcement carries both the label and the explanation', () => {
  for (const status of ALL_STATUSES) {
    const { label, description } = statusText(status);
    assert.equal(statusAnnouncement(status), `${label}. ${description}`);
  }
});

test('an unrecognised status still says something rather than nothing', () => {
  // A badge with no text equivalent reads as a bare coloured rectangle, which
  // is worse than an honest "Unknown".
  for (const value of ['SOMETHING_NEW', '', null, undefined]) {
    const { label, description } = statusText(value);
    assert.equal(label, 'Unknown');
    assert.ok(description);
  }
});

test('status lookup is case insensitive, as the dashboard filter needs', () => {
  // The dashboard holds its filter in lower case and reuses the same lookup.
  for (const status of ALL_STATUSES) {
    assert.deepEqual(statusText(status.toLowerCase()), statusText(status));
  }
});

test('a rejected verify keeps the canonical message across every status', () => {
  // describeVerifyError is the pay page's error-mapping helper. Its result must
  // not depend on the invoice status — a rejected hash always resolves through
  // the same canonical code table, never a status-specific string. The expiry
  // status description is aligned to that table too, so the two never read two
  // different sentences for the same state.
  const { describeVerifyError } = require('../lib/payment-page-state');

  const error = {
    response: { data: { code: 'MEMO_MISMATCH', error: 'Memo mismatch' } },
  };

  for (const status of ALL_STATUSES) {
    assert.equal(
      describeVerifyError(error, 'Verification failed'),
      'Memo mismatch',
      `${status} changed the verification message`
    );
  }
});


/*
 * Payment session mode matrix (issue #445).
 *
 * The pay route now drives UI from one session model. These assertions prove
 * every mode is reachable, mutually exclusive in the derive helper, and that
 * the legacy payment reducer statuses (idle/error/expired) map correctly.
 */

const {
  SESSION_STATES,
  deriveSessionStatus,
  isSessionBusy,
  isSessionResult,
} = require('../lib/payment-session');

const SESSION_MODES = [
  SESSION_STATES.LOADING,
  SESSION_STATES.READY,
  SESSION_STATES.PAYING,
  SESSION_STATES.VERIFYING,
  SESSION_STATES.PAID,
  SESSION_STATES.REJECTED,
  SESSION_STATES.UNAVAILABLE,
];

test('status matrix covers all seven payment session modes', () => {
  assert.equal(SESSION_MODES.length, 7);
  assert.equal(new Set(SESSION_MODES).size, 7);

  const cases = [
    [{ loading: true, invoice: null }, SESSION_STATES.LOADING],
    [{ loading: false, invoice: { status: 'PENDING', expiresAt: '2099-01-01T00:00:00.000Z' }, paymentStatus: 'idle' }, SESSION_STATES.READY],
    [{ loading: false, invoice: { status: 'PENDING', expiresAt: '2099-01-01T00:00:00.000Z' }, paymentStatus: 'paying' }, SESSION_STATES.PAYING],
    [{ loading: false, invoice: { status: 'PENDING', expiresAt: '2099-01-01T00:00:00.000Z' }, paymentStatus: 'verifying' }, SESSION_STATES.VERIFYING],
    [{ loading: false, invoice: { status: 'PAID', paymentTxHash: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00.000Z' } }, SESSION_STATES.PAID],
    [{ loading: false, invoice: { status: 'PENDING', expiresAt: '2099-01-01T00:00:00.000Z' }, paymentStatus: 'error' }, SESSION_STATES.REJECTED],
    [{ loading: false, invoice: { status: 'EXPIRED', expiresAt: '2000-01-01T00:00:00.000Z' } }, SESSION_STATES.UNAVAILABLE],
    [{ loading: false, invoice: null, loadError: 'unreachable' }, SESSION_STATES.UNAVAILABLE],
    [{ loading: false, invoice: { status: 'CANCELLED', expiresAt: '2099-01-01T00:00:00.000Z' } }, SESSION_STATES.UNAVAILABLE],
  ];

  const seen = new Set();
  for (const [input, expected] of cases) {
    const actual = deriveSessionStatus(input);
    assert.equal(actual, expected, JSON.stringify(input));
    seen.add(actual);
  }

  for (const mode of SESSION_MODES) {
    assert.ok(seen.has(mode), `mode ${mode} never appeared in the matrix`);
  }
});

test('busy and result partitions do not overlap across session modes', () => {
  for (const mode of SESSION_MODES) {
    const busy = isSessionBusy(mode);
    const result = isSessionResult(mode);
    if (mode === SESSION_STATES.PAYING || mode === SESSION_STATES.VERIFYING) {
      assert.equal(busy, true);
      assert.equal(result, false);
    } else if (
      mode === SESSION_STATES.PAID ||
      mode === SESSION_STATES.REJECTED ||
      mode === SESSION_STATES.UNAVAILABLE
    ) {
      assert.equal(busy, false);
      assert.equal(result, true);
    } else {
      assert.equal(busy, false);
      assert.equal(result, false);
    }
  }
});
