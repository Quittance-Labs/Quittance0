const test = require('node:test');
const assert = require('node:assert/strict');
const {
  invoiceWorkspaceAccess,
  canViewInvoiceWorkspace,
} = require('../lib/invoice-workspace-access');
const { buildInvoiceTimelineEvents } = require('../lib/invoice-timeline');

const SELLER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const OTHER_SELLER = 'GCKFBEIYTKP7RCZNVPH6PYJHLKGRDJKA76G3XV5F9RBQZBRPKUL7NXCG';
const NOW = '2026-08-30T12:00:00.000Z';

test('invoiceWorkspaceAccess: owner wallet is allowed', () => {
  const invoice = { sellerPublicKey: SELLER };
  assert.equal(invoiceWorkspaceAccess(invoice, SELLER), 'allowed');
  assert.equal(canViewInvoiceWorkspace(invoice, SELLER), true);
});

test('invoiceWorkspaceAccess: a different connected wallet is a foreign wallet, not allowed', () => {
  const invoice = { sellerPublicKey: SELLER };
  assert.equal(invoiceWorkspaceAccess(invoice, OTHER_SELLER), 'foreign-wallet');
  assert.equal(canViewInvoiceWorkspace(invoice, OTHER_SELLER), false);
});

test('invoiceWorkspaceAccess: no wallet connected asks to connect, not "foreign"', () => {
  const invoice = { sellerPublicKey: SELLER };
  assert.equal(invoiceWorkspaceAccess(invoice, null), 'wallet-required');
  assert.equal(invoiceWorkspaceAccess(invoice, undefined), 'wallet-required');
  assert.equal(canViewInvoiceWorkspace(invoice, null), false);
});

test('invoiceWorkspaceAccess: an invoice with no recorded seller key has nothing to deny access against', () => {
  assert.equal(invoiceWorkspaceAccess({ sellerPublicKey: undefined }, OTHER_SELLER), 'allowed');
  assert.equal(invoiceWorkspaceAccess(null, OTHER_SELLER), 'allowed');
});

test('buildInvoiceTimelineEvents: a fresh pending invoice has created + awaiting-payment', () => {
  const invoice = {
    status: 'PENDING',
    createdAt: '2026-08-30T10:00:00.000Z',
    expiresAt: '2026-08-31T10:00:00.000Z',
  };
  const events = buildInvoiceTimelineEvents(invoice, NOW);
  assert.deepEqual(
    events.map((e) => e.type),
    ['created', 'awaiting-payment']
  );
  assert.equal(events[1].deadline, invoice.expiresAt);
});

test('buildInvoiceTimelineEvents: an invoice past its deadline shows expired, not awaiting-payment', () => {
  const invoice = {
    status: 'PENDING',
    createdAt: '2026-08-29T10:00:00.000Z',
    expiresAt: '2026-08-30T10:00:00.000Z',
  };
  const events = buildInvoiceTimelineEvents(invoice, NOW);
  assert.deepEqual(
    events.map((e) => e.type),
    ['created', 'expired']
  );
});

test('buildInvoiceTimelineEvents: a cancelled invoice shows created + cancelled in order', () => {
  const invoice = {
    status: 'CANCELLED',
    createdAt: '2026-08-29T10:00:00.000Z',
    expiresAt: '2026-08-31T10:00:00.000Z',
    cancelledAt: '2026-08-30T09:00:00.000Z',
  };
  const events = buildInvoiceTimelineEvents(invoice, NOW);
  assert.deepEqual(
    events.map((e) => e.type),
    ['created', 'cancelled']
  );
});

test('buildInvoiceTimelineEvents: a normally paid invoice shows created + paid, no warning flag', () => {
  const invoice = {
    status: 'PAID',
    createdAt: '2026-08-29T10:00:00.000Z',
    expiresAt: '2026-08-31T10:00:00.000Z',
    settledAt: '2026-08-29T11:00:00.000Z',
    paymentTxHash: 'abc123',
    payerPublicKey: OTHER_SELLER,
  };
  const events = buildInvoiceTimelineEvents(invoice, NOW);
  assert.deepEqual(
    events.map((e) => e.type),
    ['created', 'paid']
  );
  assert.equal(events[1].lateWarningCode, null);
  assert.equal(events[1].paymentTxHash, 'abc123');
});

test('buildInvoiceTimelineEvents: a late payment after cancellation shows all three, in chronological order, flagged', () => {
  // The realistic case backend/src/domain/invoice-settlement.ts's AFTER_CANCEL
  // path produces: cancelledAt is never cleared even though a later payment
  // flips status to PAID, so the timeline must show the cancellation
  // *and* the late payment, not just whichever the final status implies.
  const invoice = {
    status: 'PAID',
    createdAt: '2026-08-29T09:00:00.000Z',
    expiresAt: '2026-08-31T09:00:00.000Z',
    cancelledAt: '2026-08-29T10:00:00.000Z',
    settledAt: '2026-08-29T11:00:00.000Z',
    priorStatus: 'CANCELLED',
    latePaymentWarningCode: 'PAYMENT_RECEIVED_AFTER_CANCEL',
    paymentTxHash: 'def456',
  };
  const events = buildInvoiceTimelineEvents(invoice, NOW);
  assert.deepEqual(
    events.map((e) => e.type),
    ['created', 'cancelled', 'paid']
  );
  assert.equal(events[2].lateWarningCode, 'PAYMENT_RECEIVED_AFTER_CANCEL');
});

test('buildInvoiceTimelineEvents: falls back to paidAt when settledAt is absent (legacy records)', () => {
  const invoice = {
    status: 'PAID',
    createdAt: '2026-08-29T10:00:00.000Z',
    expiresAt: '2026-08-31T10:00:00.000Z',
    paidAt: '2026-08-29T11:00:00.000Z',
  };
  const events = buildInvoiceTimelineEvents(invoice, NOW);
  const paidEvent = events.find((e) => e.type === 'paid');
  assert.equal(paidEvent.timestamp, invoice.paidAt);
});

test('buildInvoiceTimelineEvents: an empty/missing invoice yields no events rather than throwing', () => {
  assert.deepEqual(buildInvoiceTimelineEvents(null), []);
  assert.deepEqual(buildInvoiceTimelineEvents(undefined), []);
});
