/**
 * Drift guard for the shared settlement contract (issue #507).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as shared from '../../shared/settlement';
import * as backend from '../src/domain/invoice-settlement';

describe('shared settlement contract', () => {
  it('re-exports the same warning table from the backend domain module', () => {
    assert.deepEqual(backend.LATE_PAYMENT_WARNINGS, shared.LATE_PAYMENT_WARNINGS);
    assert.deepEqual(
      backend.LATE_PAYMENT_WARNING_DEFINITIONS,
      shared.LATE_PAYMENT_WARNING_DEFINITIONS
    );
  });

  it('classifies identical inputs the same way through either entry point', () => {
    const invoice = {
      status: 'EXPIRED' as const,
      expiresAt: '2026-09-12T23:59:00.000Z',
    };
    const closeTime = '2026-09-13T01:00:00.000Z';
    assert.deepEqual(
      backend.settlementFieldsForInvoice(invoice, closeTime),
      shared.settlementFieldsForInvoice(invoice, closeTime)
    );
  });

  it('uses the same unavailable error code', () => {
    assert.equal(new backend.SettlementTimeUnavailableError().code, 'TRANSACTION_CLOSE_TIME_UNAVAILABLE');
    assert.equal(new shared.SettlementTimeUnavailableError().code, 'TRANSACTION_CLOSE_TIME_UNAVAILABLE');
  });
});
