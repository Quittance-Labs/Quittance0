/**
 * Documented late-settlement matrix (issue #507 / docs/LATE_PAYMENT_POLICY.md).
 *
 * Classification uses Horizon close time only — never server wall clock.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LATE_PAYMENT_WARNINGS,
  SettlementTimeUnavailableError,
  latePaymentWarningForCode,
  parseSettlementTime,
  settlementFieldsForInvoice,
  timelineCopyForLatePayment,
  warningForLatePayment,
} from '../src/domain/invoice-settlement';

const EXPIRES_AT = '2026-09-12T23:59:00.000Z';
const CANCELLED_AT = '2026-09-13T12:00:00.000Z';

describe('parseSettlementTime', () => {
  it('parses Horizon ISO close times as UTC', () => {
    const parsed = parseSettlementTime('2026-09-13T14:32:00Z');
    assert.ok(parsed);
    assert.equal(parsed!.toISOString(), '2026-09-13T14:32:00.000Z');
  });

  it('returns null for missing or invalid close times (fail closed)', () => {
    assert.equal(parseSettlementTime(undefined), null);
    assert.equal(parseSettlementTime(null), null);
    assert.equal(parseSettlementTime(''), null);
    assert.equal(parseSettlementTime('not-a-date'), null);
    assert.equal(parseSettlementTime(Number.NaN), null);
  });
});

describe('settlementFieldsForInvoice matrix', () => {
  it('PENDING + close_time before expiresAt → ON_TIME', () => {
    const fields = settlementFieldsForInvoice(
      { status: 'PENDING', expiresAt: EXPIRES_AT },
      '2026-09-12T23:58:59.000Z'
    );
    assert.equal(fields.settlementContext, 'ON_TIME');
    assert.equal(fields.latePaymentWarningCode, undefined);
    assert.equal(fields.priorStatus, undefined);
  });

  it('PENDING + close_time at expiresAt → AFTER_EXPIRY (boundary is late)', () => {
    const fields = settlementFieldsForInvoice(
      { status: 'PENDING', expiresAt: EXPIRES_AT },
      EXPIRES_AT
    );
    assert.equal(fields.settlementContext, 'AFTER_EXPIRY');
    assert.equal(fields.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
    assert.equal(fields.priorStatus, 'PENDING');
  });

  it('PENDING + close_time after expiresAt → AFTER_EXPIRY', () => {
    const fields = settlementFieldsForInvoice(
      { status: 'PENDING', expiresAt: EXPIRES_AT },
      '2026-09-13T14:32:00.000Z'
    );
    assert.equal(fields.settlementContext, 'AFTER_EXPIRY');
    assert.equal(fields.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
  });

  it('clock skew: close_time before expiry stays ON_TIME when status was already EXPIRED', () => {
    const fields = settlementFieldsForInvoice(
      { status: 'EXPIRED', expiresAt: EXPIRES_AT },
      '2026-09-12T23:58:00.000Z'
    );
    assert.equal(fields.settlementContext, 'ON_TIME');
    assert.equal(fields.latePaymentWarningCode, undefined);
    assert.equal(fields.priorStatus, 'EXPIRED');
  });

  it('EXPIRED + close_time after expiresAt → AFTER_EXPIRY with priorStatus EXPIRED', () => {
    const fields = settlementFieldsForInvoice(
      { status: 'EXPIRED', expiresAt: EXPIRES_AT },
      '2026-09-13T01:00:00.000Z'
    );
    assert.equal(fields.settlementContext, 'AFTER_EXPIRY');
    assert.equal(fields.priorStatus, 'EXPIRED');
    assert.equal(fields.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
  });

  it('CANCELLED + close_time after cancelledAt → AFTER_CANCEL', () => {
    const fields = settlementFieldsForInvoice(
      { status: 'CANCELLED', cancelledAt: CANCELLED_AT, expiresAt: EXPIRES_AT },
      '2026-09-13T14:32:00.000Z'
    );
    assert.equal(fields.settlementContext, 'AFTER_CANCEL');
    assert.equal(fields.priorStatus, 'CANCELLED');
    assert.equal(fields.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_CANCEL');
  });

  it('CANCELLED + close_time before cancelledAt → ON_TIME with priorStatus CANCELLED', () => {
    const fields = settlementFieldsForInvoice(
      { status: 'CANCELLED', cancelledAt: CANCELLED_AT, expiresAt: EXPIRES_AT },
      '2026-09-13T11:00:00.000Z'
    );
    assert.equal(fields.settlementContext, 'ON_TIME');
    assert.equal(fields.priorStatus, 'CANCELLED');
    assert.equal(fields.latePaymentWarningCode, undefined);
  });

  it('CANCELLED + close_time at cancelledAt → AFTER_CANCEL (boundary is late)', () => {
    const fields = settlementFieldsForInvoice(
      { status: 'CANCELLED', cancelledAt: CANCELLED_AT, expiresAt: EXPIRES_AT },
      CANCELLED_AT
    );
    assert.equal(fields.settlementContext, 'AFTER_CANCEL');
    assert.equal(fields.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_CANCEL');
  });

  it('missing close_time throws SettlementTimeUnavailableError (never invents Date.now)', () => {
    assert.throws(
      () => settlementFieldsForInvoice({ status: 'PENDING', expiresAt: EXPIRES_AT }, undefined),
      (err: unknown) =>
        err instanceof SettlementTimeUnavailableError &&
        err.code === 'TRANSACTION_CLOSE_TIME_UNAVAILABLE'
    );
  });

  it('CANCELLED without cancelledAt fails closed', () => {
    assert.throws(
      () =>
        settlementFieldsForInvoice(
          { status: 'CANCELLED', cancelledAt: null, expiresAt: EXPIRES_AT },
          '2026-09-13T14:32:00.000Z'
        ),
      SettlementTimeUnavailableError
    );
  });
});

describe('shared late-payment copy', () => {
  it('API warning, receipt, and timeline copy all key off the same codes', () => {
    for (const code of Object.keys(LATE_PAYMENT_WARNINGS) as Array<
      keyof typeof LATE_PAYMENT_WARNINGS
    >) {
      assert.equal(warningForLatePayment(code), LATE_PAYMENT_WARNINGS[code]);
      const receipt = latePaymentWarningForCode(code);
      assert.ok(receipt);
      assert.ok(receipt!.title.length > 0);
      assert.ok(receipt!.body.length > 0);
      assert.ok(timelineCopyForLatePayment(code));
    }
  });
});
