const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidEmailFormat,
  resolvePayUrl,
  canSendInvoiceEmail,
  getInvoiceMailtoRecipient,
  canSendProofEmail,
  getProofMailtoRecipient,
  buildInvoiceMailto,
  buildProofMailto,
} = require('../lib/mailto-delivery.js');

const pendingInvoice = {
  id: '01234567-89ab-cdef-0123-456789abcdef',
  amount: 150.5,
  assetCode: 'USDC',
  status: 'PENDING',
  customerName: 'Alice Customer',
  customerEmail: 'alice@example.com',
  sellerName: 'Bob Seller',
  sellerEmail: 'bob@example.com',
  description: 'Website redesign project',
  memo: 'INV-ABC123',
  expiresAt: '2026-12-31T23:59:59.000Z',
  sellerPublicKey: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
};

const paidInvoice = {
  ...pendingInvoice,
  status: 'PAID',
  paidAt: '2026-09-01T12:00:00.000Z',
  paymentTxHash: 'a'.repeat(64),
  payerPublicKey: 'G'.padEnd(56, 'P'),
  payerName: 'Alice Payer',
  payerEmail: 'alice.payer@example.com',
};

const expiredInvoice = {
  ...pendingInvoice,
  status: 'EXPIRED',
};

test('validates email formats accurately', () => {
  assert.equal(isValidEmailFormat('user@example.com'), true);
  assert.equal(isValidEmailFormat('  user@example.com  '), true);
  assert.equal(isValidEmailFormat(''), false);
  assert.equal(isValidEmailFormat(null), false);
  assert.equal(isValidEmailFormat('invalid-email'), false);
  assert.equal(isValidEmailFormat('user@'), false);
  assert.equal(isValidEmailFormat('@example.com'), false);
});

test('resolves payment URLs across environments', () => {
  const urlWithBase = resolvePayUrl('1234', 'https://quittance.example.com');
  assert.equal(urlWithBase, 'https://quittance.example.com/pay/1234');

  const urlWithTrailingSlash = resolvePayUrl('1234', 'https://quittance.example.com/');
  assert.equal(urlWithTrailingSlash, 'https://quittance.example.com/pay/1234');
});

test('canSendInvoiceEmail checks for valid customer email', () => {
  assert.equal(canSendInvoiceEmail(pendingInvoice), true);
  assert.equal(canSendInvoiceEmail({ ...pendingInvoice, customerEmail: '' }), false);
  assert.equal(canSendInvoiceEmail({ ...pendingInvoice, customerEmail: undefined }), false);
  assert.equal(canSendInvoiceEmail({ ...pendingInvoice, customerEmail: 'not-an-email' }), false);
  assert.equal(canSendInvoiceEmail(null), false);
});

test('canSendProofEmail requires PAID status and an email recipient', () => {
  assert.equal(canSendProofEmail(paidInvoice), true);
  assert.equal(canSendProofEmail(pendingInvoice), false);
  assert.equal(canSendProofEmail(expiredInvoice), false);
  assert.equal(canSendProofEmail({ ...paidInvoice, customerEmail: '', payerEmail: '' }), false);
  assert.equal(canSendProofEmail(null), false);
});

test('getInvoiceMailtoRecipient returns trimmed customer email', () => {
  assert.equal(getInvoiceMailtoRecipient(pendingInvoice), 'alice@example.com');
  assert.equal(getInvoiceMailtoRecipient({ customerEmail: '  test@example.com  ' }), 'test@example.com');
  assert.equal(getInvoiceMailtoRecipient({}), '');
  assert.equal(getInvoiceMailtoRecipient(null), '');
});

test('getProofMailtoRecipient falls back to payerEmail if customerEmail is absent', () => {
  assert.equal(getProofMailtoRecipient(paidInvoice), 'alice@example.com');
  assert.equal(
    getProofMailtoRecipient({ ...paidInvoice, customerEmail: undefined, payerEmail: 'payer@example.com' }),
    'payer@example.com'
  );
  assert.equal(getProofMailtoRecipient({}), '');
  assert.equal(getProofMailtoRecipient(null), '');
});

test('buildInvoiceMailto generates a properly encoded mailto URL with invoice details', () => {
  const mailto = buildInvoiceMailto(pendingInvoice, 'https://quittance.example.com');

  assert.ok(mailto.startsWith('mailto:alice%40example.com?'));
  assert.ok(mailto.includes('subject=Invoice%20%2301234567%20-%20150.5%20USDC'));
  assert.ok(mailto.includes(encodeURIComponent('Invoice ID: 01234567-89ab-cdef-0123-456789abcdef')));
  assert.ok(mailto.includes(encodeURIComponent('Amount: 150.5 USDC')));
  assert.ok(mailto.includes(encodeURIComponent('Client: Alice Customer')));
  assert.ok(mailto.includes(encodeURIComponent('Seller: Bob Seller')));
  assert.ok(mailto.includes(encodeURIComponent('Description: Website redesign project')));
  assert.ok(mailto.includes(encodeURIComponent('Memo: INV-ABC123')));
  assert.ok(mailto.includes(encodeURIComponent('Payment Link: https://quittance.example.com/pay/01234567-89ab-cdef-0123-456789abcdef')));
  assert.ok(mailto.includes(encodeURIComponent('Powered by Quittance')));
});

test('buildInvoiceMailto throws an error when customer email is missing', () => {
  assert.throws(
    () => buildInvoiceMailto({ ...pendingInvoice, customerEmail: '' }),
    /Client email is required to send this invoice/
  );
  assert.throws(
    () => buildInvoiceMailto(null),
    /Invoice is required to build mailto link/
  );
});

test('buildProofMailto generates a properly encoded mailto URL with proof details', () => {
  const mailto = buildProofMailto(paidInvoice, 'https://quittance.example.com');

  assert.ok(mailto.startsWith('mailto:alice%40example.com?'));
  assert.ok(mailto.includes('subject=Payment%20Proof%20-%20Invoice%20%2301234567%20-%20150.5%20USDC'));
  assert.ok(mailto.includes(encodeURIComponent('Payment Proof Details:')));
  assert.ok(mailto.includes(encodeURIComponent('Status: PAID')));
  assert.ok(mailto.includes(encodeURIComponent(`Transaction Hash: ${'a'.repeat(64)}`)));
  assert.ok(mailto.includes(encodeURIComponent(`Seller Address: ${paidInvoice.sellerPublicKey}`)));
  assert.ok(mailto.includes(encodeURIComponent(`Payer Address: ${paidInvoice.payerPublicKey}`)));
  assert.ok(mailto.includes(encodeURIComponent('Client Name: Alice Customer')));
  assert.ok(mailto.includes(encodeURIComponent('Payer Name: Alice Payer')));
  assert.ok(mailto.includes(encodeURIComponent('Verified on Stellar Blockchain')));
  assert.ok(mailto.includes(encodeURIComponent('View Proof / Payment Details: https://quittance.example.com/pay/01234567-89ab-cdef-0123-456789abcdef')));
});

test('buildProofMailto throws when invoice is not paid or expired', () => {
  assert.throws(
    () => buildProofMailto(pendingInvoice),
    /Payment proof is available only after the invoice is paid/
  );

  assert.throws(
    () => buildProofMailto(expiredInvoice),
    /Payment proof is unavailable because this invoice expired unpaid/
  );

  assert.throws(
    () => buildProofMailto({ ...paidInvoice, customerEmail: '', payerEmail: '' }),
    /Client or payer email is required to email payment proof/
  );
});
