import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPendingInvoice } from '../src/utils/stats-pending-filter';
import {
  PENDING_CASES,
  EDGE_CASES,
} from './fixtures/stats-pending-filter.fixture';

describe('isPendingInvoice — fixture cases', () => {
  for (const c of PENDING_CASES) {
    it(c.name, () => {
      assert.equal(isPendingInvoice(c.invoice), c.expected);
    });
  }
});

describe('isPendingInvoice — edge cases', () => {
  for (const c of EDGE_CASES) {
    it(c.name, () => {
      assert.equal(isPendingInvoice(c.invoice), c.expected);
    });
  }

  it('returns false for missing invoice', () => {
    assert.equal(isPendingInvoice(undefined as any), false);
  });
});
