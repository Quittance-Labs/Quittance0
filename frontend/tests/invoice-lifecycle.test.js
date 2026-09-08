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
