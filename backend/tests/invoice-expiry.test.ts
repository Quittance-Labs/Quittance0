import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateInvoiceExpiry,
  isPendingInvoiceExpired,
  validateInvoiceExpiryDays,
} from '../src/domain/invoice-expiry.ts';

describe('invoice expiry domain', () => {
  it('defaults to seven days and accepts the inclusive 1-30 day range', () => {
    assert.equal(validateInvoiceExpiryDays(undefined), 7);
    assert.equal(validateInvoiceExpiryDays(1), 1);
    assert.equal(validateInvoiceExpiryDays(30), 30);
  });

  it('rejects fractional and out-of-range payment windows', () => {
    for (const value of [0, 31, 1.5, '7', Number.NaN]) {
      assert.throws(() => validateInvoiceExpiryDays(value), /integer between 1 and 30 days/);
    }
  });

  it('calculates against an injected clock and expires at the exact boundary', () => {
    const now = new Date('2026-08-30T12:00:00.000Z');
    const expiresAt = calculateInvoiceExpiry(1, now);
    assert.equal(expiresAt.toISOString(), '2026-08-31T12:00:00.000Z');
    assert.equal(isPendingInvoiceExpired({ status: 'PENDING', expiresAt }, expiresAt), true);
    assert.equal(isPendingInvoiceExpired({ status: 'PAID', expiresAt }, expiresAt), false);
  });
});
