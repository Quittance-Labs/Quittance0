import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPendingInvoice,
  PENDING_STATUS,
} from '../src/utils/stats-pending-filter';
import {
  VALID_PENDING_CASES,
  NON_PENDING_CASES,
  MALFORMED_INVOICE_CASES,
} from './fixtures/stats-pending-filter.fixture';

describe('PENDING_STATUS constant', () => {
  it('equals PENDING', () => {
    assert.equal(PENDING_STATUS, 'PENDING');
  });
});

describe('isPendingInvoice — valid pending cases', () => {
  for (const fixture of VALID_PENDING_CASES) {
    it(fixture.name, () => {
      const result = isPendingInvoice(fixture.invoice);
      assert.equal(result, fixture.expectedResult);
    });
  }
});

describe('isPendingInvoice — non-pending status cases', () => {
  for (const fixture of NON_PENDING_CASES) {
    it(fixture.name, () => {
      const result = isPendingInvoice(fixture.invoice);
      assert.equal(result, fixture.expectedResult);
    });
  }
});

describe('isPendingInvoice — malformed and edge cases', () => {
  for (const fixture of MALFORMED_INVOICE_CASES) {
    it(fixture.name, () => {
      const result = isPendingInvoice(fixture.invoice);
      assert.equal(result, fixture.expectedResult);
    });
  }
});

describe('isPendingInvoice — array filter usage', () => {
  it('correctly filters a mixed list of invoices', () => {
    const invoices = [
      { sellerPublicKey: 'GA1', amount: 10, assetCode: 'XLM', status: 'PENDING' as const },
      { sellerPublicKey: 'GA1', amount: 20, assetCode: 'XLM', status: 'PAID' as const },
      { sellerPublicKey: 'GA1', amount: 30, assetCode: 'XLM', status: 'PENDING' as const },
      { sellerPublicKey: 'GA1', amount: 40, assetCode: 'XLM', status: 'EXPIRED' as const },
      { sellerPublicKey: 'GA1', amount: 50, assetCode: 'XLM', status: 'CANCELLED' as const },
    ];

    const pending = invoices.filter(isPendingInvoice);
    assert.equal(pending.length, 2);
    assert.equal(pending[0].amount, 10);
    assert.equal(pending[1].amount, 30);
  });

  it('returns empty array when no invoices are pending', () => {
    const invoices = [
      { status: 'PAID' as const },
      { status: 'EXPIRED' as const },
    ];
    const pending = invoices.filter(isPendingInvoice);
    assert.equal(pending.length, 0);
  });

  it('handles empty input array', () => {
    const invoices: Array<{ status: string }> = [];
    const pending = invoices.filter(isPendingInvoice);
    assert.equal(pending.length, 0);
  });
});
