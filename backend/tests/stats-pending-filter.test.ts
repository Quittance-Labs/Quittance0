import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPendingInvoice } from '../src/utils/stats-pending-filter';
import { PENDING_INVOICE_CASES } from './fixtures/stats-pending-filter.fixture';

describe('isPendingInvoice — contract fixtures', () => {
  for (const fixture of PENDING_INVOICE_CASES) {
    it(fixture.name, () => {
      const result = isPendingInvoice(fixture.invoice);
      assert.equal(result, fixture.expectedResult);
    });
  }
});

describe('isPendingInvoice — direct edge cases', () => {
  it('classifies a realistic StoredInvoice-shaped PENDING record as pending', () => {
    const invoice = {
      id: 'inv_1',
      sellerPublicKey: 'GABC...',
      amount: 100,
      assetCode: 'USDC',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(),
    };
    assert.equal(isPendingInvoice(invoice), true);
  });

  it('classifies a realistic StoredInvoice-shaped PAID record as not pending', () => {
    const invoice = {
      id: 'inv_2',
      sellerPublicKey: 'GABC...',
      amount: 100,
      assetCode: 'USDC',
      status: 'PAID',
      createdAt: new Date(),
      paidAt: new Date(),
      expiresAt: new Date(),
    };
    assert.equal(isPendingInvoice(invoice), false);
  });

  it('does not throw on an invoice with extra/unrelated fields', () => {
    assert.doesNotThrow(() =>
      isPendingInvoice({ status: 'PENDING', metadata: { note: 'x' } } as any)
    );
  });
});

export default isPendingInvoice;
