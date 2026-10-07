import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PUBLIC_INVOICE_FIELDS,
  SELLER_ONLY_INVOICE_FIELDS,
  isPublicInvoiceField,
  isSellerOnlyInvoiceField,
  omitSellerOnlyFields,
  toPublicInvoiceDto,
} from '../../shared/invoice.ts';

/**
 * Issue #559 — the public allowlist and seller-only denylist are the contract.
 * Each key is named here so removing it from the shared constant fails this file.
 */
describe('public invoice whitelist (issue #559)', () => {
  const EXPECTED_PUBLIC_FIELDS = [
    'id',
    'sellerPublicKey',
    'amount',
    'assetCode',
    'assetIssuer',
    'memo',
    'status',
    'paymentTxHash',
    'latePaymentWarningCode',
    'settlementContext',
    'priorStatus',
    'createdAt',
    'paidAt',
    'cancelledAt',
    'settledAt',
    'expiresAt',
  ] as const;

  const EXPECTED_SELLER_ONLY_FIELDS = [
    'customerName',
    'customerEmail',
    'sellerName',
    'sellerEmail',
    'payerPublicKey',
    'payerName',
    'payerEmail',
    'description',
    'metadata',
    'userId',
  ] as const;

  it('PUBLIC_INVOICE_FIELDS lists every expected public pay key', () => {
    assert.deepEqual([...PUBLIC_INVOICE_FIELDS], [...EXPECTED_PUBLIC_FIELDS]);
  });

  for (const key of EXPECTED_PUBLIC_FIELDS) {
    it(`whitelist includes public key: ${key}`, () => {
      assert.equal(isPublicInvoiceField(key), true, `missing public key ${key}`);
      assert.ok(
        (PUBLIC_INVOICE_FIELDS as readonly string[]).includes(key),
        `PUBLIC_INVOICE_FIELDS dropped ${key}`
      );
    });
  }

  it('SELLER_ONLY_INVOICE_FIELDS lists every forbidden identity key', () => {
    assert.deepEqual([...SELLER_ONLY_INVOICE_FIELDS], [...EXPECTED_SELLER_ONLY_FIELDS]);
  });

  for (const key of EXPECTED_SELLER_ONLY_FIELDS) {
    it(`denylist includes seller-only key: ${key}`, () => {
      assert.equal(isSellerOnlyInvoiceField(key), true, `missing seller-only key ${key}`);
      assert.equal(
        isPublicInvoiceField(key),
        false,
        `seller-only key ${key} must not be public`
      );
    });
  }

  it('toPublicInvoiceDto drops every seller-only key even when present on input', () => {
    const publicDto = toPublicInvoiceDto({
      id: 'inv_1',
      sellerPublicKey: 'G'.padEnd(56, 'A'),
      amount: 10,
      assetCode: 'XLM',
      memo: 'INV-TEST',
      status: 'PENDING',
      createdAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-09-08T00:00:00.000Z',
      customerName: 'Client Co',
      customerEmail: 'pay@client.example',
      sellerName: 'Studio',
      sellerEmail: 'studio@example.com',
      payerName: 'Percy',
      payerEmail: 'percy@payer.example',
      payerPublicKey: 'G'.padEnd(56, 'P'),
      description: 'secret work',
      metadata: { note: 'nope' },
      userId: 'user_1',
    } as any);

    for (const key of EXPECTED_SELLER_ONLY_FIELDS) {
      assert.equal(
        (publicDto as Record<string, unknown>)[key],
        undefined,
        `public DTO leaked ${key}`
      );
    }
    for (const key of Object.keys(publicDto)) {
      assert.ok(
        (PUBLIC_INVOICE_FIELDS as readonly string[]).includes(key),
        `public DTO carries non-whitelisted key ${key}`
      );
    }
  });

  it('omitSellerOnlyFields strips denylisted keys from an arbitrary payload', () => {
    const cleaned = omitSellerOnlyFields({
      id: 'inv_1',
      amount: 5,
      customerEmail: 'leak@example.com',
      payerName: 'Leak',
      memo: 'INV-KEEP',
      userId: 'u1',
    });
    assert.equal('customerEmail' in cleaned, false);
    assert.equal('payerName' in cleaned, false);
    assert.equal('userId' in cleaned, false);
    assert.equal(cleaned.memo, 'INV-KEEP');
    assert.equal(cleaned.amount, 5);
  });
});
