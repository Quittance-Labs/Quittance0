const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyExpiryLifecycle,
  applyExpiryStatus,
  effectiveInvoiceStatus,
  hasInvoiceExpired,
  isActionableInvoice,
} = require('../lib/invoice-lifecycle');

const NOW = '2026-08-30T12:00:00.000Z';

test('a pending invoice expires at its exact timestamp', () => {
  const invoice = { status: 'PENDING', expiresAt: NOW };
  assert.equal(hasInvoiceExpired(invoice, NOW), true);
  assert.equal(effectiveInvoiceStatus(invoice, NOW), 'EXPIRED');
  assert.equal(isActionableInvoice(invoice, NOW), false);
});

test('future pending invoices remain actionable and paid invoices never regress', () => {
  const future = { status: 'PENDING', expiresAt: '2026-08-31T12:00:00.000Z' };
  const paid = { status: 'PAID', expiresAt: '2026-08-29T12:00:00.000Z' };
  assert.equal(isActionableInvoice(future, NOW), true);
  assert.equal(effectiveInvoiceStatus(paid, NOW), 'PAID');
});

test('lifecycle projection does not mutate stale API objects', () => {
  const stale = { id: 'old', status: 'PENDING', expiresAt: '2026-08-29T12:00:00.000Z' };
  const projected = applyExpiryStatus(stale, NOW);
  assert.equal(projected.status, 'EXPIRED');
  assert.equal(stale.status, 'PENDING');
  assert.deepEqual(applyExpiryLifecycle([stale], NOW), [projected]);
});

test('missing or malformed expiry never invents an expiration', () => {
  assert.equal(hasInvoiceExpired({ status: 'PENDING' }, NOW), false);
  assert.equal(hasInvoiceExpired({ status: 'PENDING', expiresAt: 'bad' }, NOW), false);
  assert.equal(hasInvoiceExpired(null, NOW), false);
});

const {
  LEGAL_INVOICE_TRANSITIONS,
  isLegalInvoiceTransition,
  isTerminalInvoiceStatus,
  isUiTerminalInvoiceStatus,
} = require('../lib/invoice-lifecycle');

test('frontend lifecycle mirrors backend transition table', () => {
  assert.deepEqual([...LEGAL_INVOICE_TRANSITIONS.PENDING], ['PAID', 'CANCELLED', 'EXPIRED']);
  assert.deepEqual([...LEGAL_INVOICE_TRANSITIONS.CANCELLED], ['PAID']);
  assert.deepEqual([...LEGAL_INVOICE_TRANSITIONS.EXPIRED], ['PAID']);
  assert.deepEqual([...LEGAL_INVOICE_TRANSITIONS.PAID], []);

  assert.equal(isLegalInvoiceTransition('PENDING', 'PAID'), true);
  assert.equal(isLegalInvoiceTransition('PAID', 'CANCELLED'), false);
  assert.equal(isLegalInvoiceTransition('CANCELLED', 'PAID'), false);
  assert.equal(isLegalInvoiceTransition('CANCELLED', 'PAID', { settledAt: NOW }), true);
  assert.equal(isLegalInvoiceTransition('EXPIRED', 'PAID', { settledAt: NOW }), true);

  assert.equal(isTerminalInvoiceStatus('PAID'), true);
  assert.equal(isTerminalInvoiceStatus('EXPIRED'), false);
  assert.equal(isUiTerminalInvoiceStatus('cancelled'), true);
  assert.equal(isUiTerminalInvoiceStatus('PENDING'), false);
});
