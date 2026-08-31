import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPendingInvoice } from '../src/utils/stats-pending-filter';
import { PENDING_INVOICE_FIXTURE } from './fixtures/stats-pending-filter.fixture';

describe('isPendingInvoice', () => {
  for (const { name, invoice, expected } of PENDING_INVOICE_FIXTURE) {
    it(`returns ${expected} for ${name}`, () => {
      assert.equal(isPendingInvoice(invoice as any), expected);
    });
  }
});
