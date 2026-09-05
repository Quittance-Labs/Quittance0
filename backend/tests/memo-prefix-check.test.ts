import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasInvoiceMemoPrefix,
  INVOICE_MEMO_PREFIX,
} from '../src/utils/memo-prefix-check';
import {
  VALID_MEMO_PREFIX_FIXTURES,
  INVALID_MEMO_PREFIX_FIXTURES,
} from './fixtures/memo-prefix-check.fixture';

describe('INVOICE_MEMO_PREFIX', () => {
  it('is defined as INV-', () => {
    assert.equal(INVOICE_MEMO_PREFIX, 'INV-');
  });
});

describe('hasInvoiceMemoPrefix — valid fixtures', () => {
  for (const fixture of VALID_MEMO_PREFIX_FIXTURES) {
    it(`accepts ${fixture.description} (${String(fixture.memo)})`, () => {
      assert.equal(hasInvoiceMemoPrefix(fixture.memo), true);
    });
  }
});

describe('hasInvoiceMemoPrefix — invalid fixtures & edge cases', () => {
  for (const fixture of INVALID_MEMO_PREFIX_FIXTURES) {
    it(`rejects ${fixture.description} (${JSON.stringify(fixture.memo)})`, () => {
      assert.equal(hasInvoiceMemoPrefix(fixture.memo), false);
    });
  }
});
