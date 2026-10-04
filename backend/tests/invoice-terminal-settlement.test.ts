import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LEGAL_TERMINAL_TRANSITIONS,
  assertCancelTransitionAllowed,
  assertPaidTransitionAllowed,
  cancelConflictForStatus,
  isLegalTerminalTransition,
  InvoiceTerminalConflictError,
} from '../src/domain/invoice-settlement.ts';

describe('terminal invoice transitions (issue #558)', () => {
  it('lists the legal terminal transitions including late settlement', () => {
    assert.deepEqual(
      [...LEGAL_TERMINAL_TRANSITIONS],
      [
        ['PENDING', 'CANCELLED'],
        ['PENDING', 'PAID'],
        ['EXPIRED', 'PAID'],
        ['CANCELLED', 'PAID'],
      ]
    );
  });

  it('forbids leaving PAID for CANCELLED', () => {
    assert.equal(isLegalTerminalTransition('PAID', 'CANCELLED'), false);
    assert.throws(
      () => assertCancelTransitionAllowed('PAID', 'abc'),
      (error: unknown) =>
        error instanceof InvoiceTerminalConflictError &&
        error.code === 'INVOICE_ALREADY_PAID' &&
        error.paymentTxHash === 'abc'
    );
  });

  it('forbids a second cancel once CANCELLED won', () => {
    assert.throws(
      () => assertCancelTransitionAllowed('CANCELLED'),
      (error: unknown) =>
        error instanceof InvoiceTerminalConflictError &&
        error.code === 'INVOICE_ALREADY_CANCELLED'
    );
  });

  it('allows late CANCELLED → PAID settlement while keeping PAID hard-terminal', () => {
    assert.equal(isLegalTerminalTransition('CANCELLED', 'PAID'), true);
    assert.doesNotThrow(() => assertPaidTransitionAllowed('CANCELLED'));
    assert.doesNotThrow(() => assertPaidTransitionAllowed('PAID')); // idempotent gate
  });

  it('maps cancel losers to stable codes without inventing new wording', () => {
    assert.equal(cancelConflictForStatus('PAID', 'tx').code, 'INVOICE_ALREADY_PAID');
    assert.equal(cancelConflictForStatus('CANCELLED').code, 'INVOICE_ALREADY_CANCELLED');
    assert.equal(cancelConflictForStatus('EXPIRED').code, 'INVOICE_EXPIRED');
  });
});
