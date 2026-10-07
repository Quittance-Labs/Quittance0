const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Issue #559 — pay page fixtures may only carry public fields. The lists are
 * read from shared/invoice.ts as source text (no TS loader required) so each
 * named key failing here means it was removed from the shared constant.
 */
function readSharedArray(constName) {
  const source = fs.readFileSync(
    path.join(__dirname, '../../shared/invoice.ts'),
    'utf8'
  );
  const start = source.indexOf(`export const ${constName}`);
  assert.ok(start >= 0, `shared/invoice.ts must export ${constName}`);
  const bracket = source.indexOf('[', start);
  const end = source.indexOf(']', bracket);
  const block = source.slice(bracket, end + 1);
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const PUBLIC_INVOICE_FIELDS = readSharedArray('PUBLIC_INVOICE_FIELDS');
const SELLER_ONLY_INVOICE_FIELDS = readSharedArray('SELLER_ONLY_INVOICE_FIELDS');

test('pay page fixture rejects every seller-only key (#559)', () => {
  /** @type {Record<string, unknown>} */
  const payPageFixture = {
    id: 'inv_pay',
    sellerPublicKey: 'G'.padEnd(56, 'S'),
    amount: 42.5,
    assetCode: 'XLM',
    memo: 'INV-PAY',
    status: 'PENDING',
    createdAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-09-08T00:00:00.000Z',
  };

  for (const key of [
    'id',
    'sellerPublicKey',
    'amount',
    'assetCode',
    'memo',
    'status',
    'createdAt',
    'expiresAt',
  ]) {
    assert.notEqual(payPageFixture[key], undefined, `fixture missing public key ${key}`);
  }

  for (const key of SELLER_ONLY_INVOICE_FIELDS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(payPageFixture, key),
      false,
      `pay page fixture leaked seller-only key ${key}`
    );
    assert.equal(
      PUBLIC_INVOICE_FIELDS.includes(key),
      false,
      `seller-only key ${key} must stay off PUBLIC_INVOICE_FIELDS`
    );
  }
});

for (const key of [
  'id',
  'sellerPublicKey',
  'amount',
  'assetCode',
  'memo',
  'status',
  'expiresAt',
  'paymentTxHash',
  'createdAt',
]) {
  test(`PUBLIC_INVOICE_FIELDS still names ${key}`, () => {
    assert.ok(PUBLIC_INVOICE_FIELDS.includes(key), `whitelist dropped ${key}`);
  });
}

for (const key of [
  'customerEmail',
  'customerName',
  'payerEmail',
  'payerName',
  'sellerEmail',
  'sellerName',
  'description',
  'metadata',
]) {
  test(`SELLER_ONLY_INVOICE_FIELDS still names ${key}`, () => {
    assert.ok(SELLER_ONLY_INVOICE_FIELDS.includes(key), `denylist dropped ${key}`);
  });
}
