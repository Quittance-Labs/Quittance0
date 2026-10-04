import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseSettlementTime,
  settlementFieldsForInvoice,
  SettlementTimeUnavailableError,
} from '../../shared/settlement';

const expiresAt = '2026-09-13T02:00:00Z';

for (const value of [
  '2026-09-13T00:30:00', // The original result depended on the server's TZ.
  '2026-09-13',
  '09/13/2026 00:30:00',
  '2026-02-30T00:30:00Z',
  '2026-02-29T00:30:00Z',
  '2026-04-31T00:30:00+05:30',
  '2026-09-13T24:00:00Z',
  '2026-09-13T00:30:00+24:00',
  '2026-09-13T00:30:00Z trailing',
  '0',
]) {
  test(`reject ambiguous or invalid close time: ${value}`, () => {
    assert.equal(parseSettlementTime(value), null);
    assert.throws(
      () => settlementFieldsForInvoice({ status: 'PENDING', expiresAt }, value),
      SettlementTimeUnavailableError,
    );
  });
}

for (const [value, expected] of [
  ['2026-09-13T02:00:00Z', '2026-09-13T02:00:00.000Z'],
  ['2026-09-13T07:30:00+05:30', '2026-09-13T02:00:00.000Z'],
  ['2026-09-12T22:00:00-04:00', '2026-09-13T02:00:00.000Z'],
  ['2024-02-29T12:00:00.123456Z', '2024-02-29T12:00:00.123Z'],
  ['2000-02-29T12:00:00Z', '2000-02-29T12:00:00.000Z'],
  ['2026-09-13t02:00:00z', '2026-09-13T02:00:00.000Z'],
]) {
  test(`preserve explicit instant: ${value}`, () => {
    assert.equal(parseSettlementTime(value)?.toISOString(), expected);
  });
}

test('Date and millisecond epoch inputs retain their behavior', () => {
  const date = new Date(expiresAt);
  assert.equal(parseSettlementTime(date), date);
  assert.equal(parseSettlementTime(date.getTime())?.getTime(), date.getTime());
  for (const value of [undefined, null, '', Number.NaN, Infinity, new Date('invalid')]) {
    assert.equal(parseSettlementTime(value), null);
  }
});

test('equivalent offsets retain the late boundary, warning and cancellation policy', () => {
  for (const closeTime of ['2026-09-13T02:00:00Z', '2026-09-12T22:00:00-04:00']) {
    const expired = settlementFieldsForInvoice({ status: 'PENDING', expiresAt }, closeTime);
    assert.equal(expired.settlementContext, 'AFTER_EXPIRY');
    assert.equal(expired.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
    const cancelled = settlementFieldsForInvoice(
      { status: 'CANCELLED', cancelledAt: expiresAt }, closeTime,
    );
    assert.equal(cancelled.settlementContext, 'AFTER_CANCEL');
    assert.equal(cancelled.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_CANCEL');
  }
  const onTime = settlementFieldsForInvoice(
    { status: 'EXPIRED', expiresAt }, '2026-09-12T21:59:59-04:00',
  );
  assert.equal(onTime.settlementContext, 'ON_TIME');
  assert.equal(onTime.priorStatus, 'EXPIRED');
});
