import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasInvoiceMemoPrefix,
  INVOICE_MEMO_PREFIX,
} from '../src/utils/memo-prefix-check';
import { PREFIX_CHECK_CASES } from './fixtures/memo-prefix-check.fixture';

describe('INVOICE_MEMO_PREFIX constant', () => {
  it('is "INV-"', () => {
    assert.equal(INVOICE_MEMO_PREFIX, 'INV-');
  });
});

describe('hasInvoiceMemoPrefix — fixture cases', () => {
  for (const c of PREFIX_CHECK_CASES) {
    it(c.name, () => {
      assert.equal(hasInvoiceMemoPrefix(c.memo), c.expectedResult);
    });
  }
});

describe('hasInvoiceMemoPrefix — generated invoice memo', () => {
  it('returns true for a typical generated invoice memo', () => {
    const memo = 'INV-LX7Q9A3B-KM2P8NQR';
    assert.equal(hasInvoiceMemoPrefix(memo), true);
  });

  it('returns false for a random short reference', () => {
    const memo = 'KM2P8NQRST';
    assert.equal(hasInvoiceMemoPrefix(memo), false);
  });
});

export default hasInvoiceMemoPrefix;
