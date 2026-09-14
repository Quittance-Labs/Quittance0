import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySettlement,
  getLatePaymentProofNotice,
  formatUtcDateTime,
} from '../src/domain/late-payment-policy';

describe('Invoice settlement policy transition table', () => {
  const expiresAt = new Date('2026-09-12T23:59:00.000Z');
  const cancelledAt = new Date('2026-09-13T12:00:00.000Z');

  it('classifies PENDING with ledger time strictly before expiresAt as ON_TIME', () => {
    const beforeExpiry = new Date('2026-09-12T23:58:59.000Z');
    const result = classifySettlement({
      status: 'PENDING',
      expiresAt,
      ledgerCloseTime: beforeExpiry,
    });

    assert.equal(result.settlementContext, 'ON_TIME');
    assert.equal(result.isLate, false);
    assert.equal(result.latePaymentWarningCode, undefined);
    assert.equal(result.priorStatus, undefined);
  });

  it('classifies PENDING with ledger time at exactly expiresAt as AFTER_EXPIRY', () => {
    const result = classifySettlement({
      status: 'PENDING',
      expiresAt,
      ledgerCloseTime: expiresAt,
    });

    assert.equal(result.settlementContext, 'AFTER_EXPIRY');
    assert.equal(result.isLate, true);
    assert.equal(result.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
    assert.equal(result.warningMessage, 'Payment was received after this invoice expired.');
  });

  it('classifies PENDING with ledger time after expiresAt as AFTER_EXPIRY', () => {
    const afterExpiry = new Date('2026-09-13T14:32:00.000Z');
    const result = classifySettlement({
      status: 'PENDING',
      expiresAt,
      ledgerCloseTime: afterExpiry,
    });

    assert.equal(result.settlementContext, 'AFTER_EXPIRY');
    assert.equal(result.isLate, true);
    assert.equal(result.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
  });

  it('classifies EXPIRED with ledger time before expiresAt as ON_TIME with priorStatus EXPIRED', () => {
    const beforeExpiry = new Date('2026-09-12T20:00:00.000Z');
    const result = classifySettlement({
      status: 'EXPIRED',
      expiresAt,
      ledgerCloseTime: beforeExpiry,
    });

    assert.equal(result.settlementContext, 'ON_TIME');
    assert.equal(result.priorStatus, 'EXPIRED');
    assert.equal(result.isLate, false);
    assert.equal(result.latePaymentWarningCode, undefined);
  });

  it('classifies EXPIRED with ledger time at exactly expiresAt as AFTER_EXPIRY with priorStatus EXPIRED', () => {
    const result = classifySettlement({
      status: 'EXPIRED',
      expiresAt,
      ledgerCloseTime: expiresAt,
    });

    assert.equal(result.settlementContext, 'AFTER_EXPIRY');
    assert.equal(result.priorStatus, 'EXPIRED');
    assert.equal(result.isLate, true);
    assert.equal(result.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
  });

  it('classifies EXPIRED with ledger time after expiresAt as AFTER_EXPIRY with priorStatus EXPIRED', () => {
    const afterExpiry = new Date('2026-09-13T14:32:00.000Z');
    const result = classifySettlement({
      status: 'EXPIRED',
      expiresAt,
      ledgerCloseTime: afterExpiry,
    });

    assert.equal(result.settlementContext, 'AFTER_EXPIRY');
    assert.equal(result.priorStatus, 'EXPIRED');
    assert.equal(result.isLate, true);
    assert.equal(result.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
  });

  it('classifies CANCELLED with ledger time before cancelledAt as ON_TIME with priorStatus CANCELLED', () => {
    const beforeCancel = new Date('2026-09-13T11:59:59.000Z');
    const result = classifySettlement({
      status: 'CANCELLED',
      expiresAt,
      cancelledAt,
      ledgerCloseTime: beforeCancel,
    });

    assert.equal(result.settlementContext, 'ON_TIME');
    assert.equal(result.priorStatus, 'CANCELLED');
    assert.equal(result.isLate, false);
    assert.equal(result.latePaymentWarningCode, undefined);
  });

  it('classifies CANCELLED with ledger time at exactly cancelledAt as AFTER_CANCEL', () => {
    const result = classifySettlement({
      status: 'CANCELLED',
      expiresAt,
      cancelledAt,
      ledgerCloseTime: cancelledAt,
    });

    assert.equal(result.settlementContext, 'AFTER_CANCEL');
    assert.equal(result.priorStatus, 'CANCELLED');
    assert.equal(result.isLate, true);
    assert.equal(result.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_CANCEL');
    assert.equal(result.warningMessage, 'Payment was received after this invoice was cancelled.');
  });

  it('classifies CANCELLED with ledger time after cancelledAt as AFTER_CANCEL', () => {
    const afterCancel = new Date('2026-09-13T14:32:00.000Z');
    const result = classifySettlement({
      status: 'CANCELLED',
      expiresAt,
      cancelledAt,
      ledgerCloseTime: afterCancel,
    });

    assert.equal(result.settlementContext, 'AFTER_CANCEL');
    assert.equal(result.priorStatus, 'CANCELLED');
    assert.equal(result.isLate, true);
    assert.equal(result.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_CANCEL');
  });

  it('classifies CANCELLED without cancelledAt timestamp as AFTER_CANCEL', () => {
    const ledgerTime = new Date('2026-09-13T14:32:00.000Z');
    const result = classifySettlement({
      status: 'CANCELLED',
      expiresAt,
      ledgerCloseTime: ledgerTime,
    });

    assert.equal(result.settlementContext, 'AFTER_CANCEL');
    assert.equal(result.priorStatus, 'CANCELLED');
    assert.equal(result.isLate, true);
    assert.equal(result.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_CANCEL');
  });
});

describe('Proof notice wording', () => {
  const txHash = 'a'.repeat(64);
  const expiresAt = new Date('2026-09-12T23:59:00.000Z');
  const cancelledAt = new Date('2026-09-13T12:00:00.000Z');
  const settledAt = new Date('2026-09-13T14:32:00.000Z');

  it('formats UTC date times as expected', () => {
    assert.equal(formatUtcDateTime(settledAt), '2026-09-13 14:32 UTC');
    assert.equal(formatUtcDateTime(expiresAt), '2026-09-12 23:59 UTC');
  });

  it('returns null notice for ON_TIME settlement', () => {
    const notice = getLatePaymentProofNotice('ON_TIME', {
      settledAt,
      expiresAt,
      txHash,
    });
    assert.equal(notice, null);
  });

  it('generates exact wording for AFTER_EXPIRY', () => {
    const notice = getLatePaymentProofNotice('AFTER_EXPIRY', {
      settledAt,
      expiresAt,
      txHash,
    });
    assert.notEqual(notice, null);
    assert.equal(notice?.title, 'Payment received after invoice expiry');
    assert.match(notice!.body, /This payment settled on Stellar at 2026-09-13 14:32 UTC\./);
    assert.match(notice!.body, /The invoice expired at 2026-09-12 23:59 UTC\./);
    assert.match(notice!.body, /Transaction: a{64}/);
  });

  it('generates exact wording for AFTER_CANCEL', () => {
    const notice = getLatePaymentProofNotice('AFTER_CANCEL', {
      settledAt,
      expiresAt,
      cancelledAt,
      txHash,
    });
    assert.notEqual(notice, null);
    assert.equal(notice?.title, 'Payment received after cancellation');
    assert.match(notice!.body, /This payment settled on Stellar at 2026-09-13 14:32 UTC\./);
    assert.match(notice!.body, /The seller cancelled the payment request at 2026-09-13 12:00 UTC\./);
    assert.match(notice!.body, /Transaction: a{64}/);
  });
});
