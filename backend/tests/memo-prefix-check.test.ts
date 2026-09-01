import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasInvoiceMemoPrefix,
  INVOICE_MEMO_PREFIX,
} from '../src/utils/memo-prefix-check';
import {
  VALID_MEMO_PREFIX_CASES,
  INVALID_MEMO_PREFIX_CASES,
} from './fixtures/memo-prefix-check.fixture';
import { isValidMemo } from '../src/utils/memo';

describe('INVOICE_MEMO_PREFIX', () => {
  it('is set to INV-', () => {
    assert.equal(INVOICE_MEMO_PREFIX, 'INV-');
  });
});

describe('hasInvoiceMemoPrefix — valid cases from fixtures', () => {
  for (const fixture of VALID_MEMO_PREFIX_CASES) {
    it(fixture.name, () => {
      const result = hasInvoiceMemoPrefix(fixture.memo);
      assert.equal(result, fixture.expectedResult);
    });
  }
});

describe('hasInvoiceMemoPrefix — invalid cases from fixtures', () => {
  for (const fixture of INVALID_MEMO_PREFIX_CASES) {
    it(fixture.name, () => {
      const result = hasInvoiceMemoPrefix(fixture.memo);
      assert.equal(result, fixture.expectedResult);
    });
  }
});

describe('hasInvoiceMemoPrefix — direct edge cases', () => {
  it('returns true for string strictly starting with INV-', () => {
    assert.equal(hasInvoiceMemoPrefix('INV-FOO'), true);
  });

  it('returns false for non-string types and primitives', () => {
    assert.equal(hasInvoiceMemoPrefix(null), false);
    assert.equal(hasInvoiceMemoPrefix(undefined), false);
    assert.equal(hasInvoiceMemoPrefix(123), false);
    assert.equal(hasInvoiceMemoPrefix({}), false);
    assert.equal(hasInvoiceMemoPrefix([]), false);
    assert.equal(hasInvoiceMemoPrefix(true), false);
    assert.equal(hasInvoiceMemoPrefix(false), false);
  });

  it('integrates with isValidMemo in memo.ts', () => {
    assert.equal(isValidMemo('INV-TIMESTAMP-RANDOM123'), true);
    assert.equal(isValidMemo('PAY-TIMESTAMP-RANDOM123'), false);
    assert.equal(isValidMemo('inv-timestamp-random123'), false);
  });
});
