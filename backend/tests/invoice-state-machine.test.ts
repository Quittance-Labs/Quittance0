import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INVOICE_STATUSES,
  LEGAL_INVOICE_TRANSITIONS,
  IllegalStateTransitionError,
  assertLegalInvoiceTransition,
  isLegalInvoiceTransition,
  isTerminalInvoiceStatus,
  isUiTerminalInvoiceStatus,
} from '../src/domain/invoice-lifecycle.ts';
import type { InvoiceStatus } from '../src/domain/invoice-lifecycle.ts';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers.ts';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage.ts';

const SELLER_KEY = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const PAYER_KEY = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

function createMockResponse(): any {
  const res: any = { statusCode: 200, body: null };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  return res;
}

function createMockRequest(
  options: { params?: Record<string, string>; body?: Record<string, unknown> } = {}
): any {
  return {
    params: options.params ?? {},
    body: options.body ?? {},
    query: {},
  };
}

describe('Invoice lifecycle domain transitions (issue #443)', () => {
  it('classifies fully-terminal and UI-terminal statuses', () => {
    assert.equal(isTerminalInvoiceStatus('PAID'), true);
    assert.equal(isTerminalInvoiceStatus('EXPIRED'), false);
    assert.equal(isTerminalInvoiceStatus('CANCELLED'), false);
    assert.equal(isTerminalInvoiceStatus('PENDING'), false);

    assert.equal(isUiTerminalInvoiceStatus('PAID'), true);
    assert.equal(isUiTerminalInvoiceStatus('EXPIRED'), true);
    assert.equal(isUiTerminalInvoiceStatus('CANCELLED'), true);
    assert.equal(isUiTerminalInvoiceStatus('PENDING'), false);
  });

  it('permits valid transitions from PENDING', () => {
    assert.equal(isLegalInvoiceTransition('PENDING', 'PAID'), true);
    assert.equal(isLegalInvoiceTransition('PENDING', 'CANCELLED'), true);
    assert.equal(isLegalInvoiceTransition('PENDING', 'EXPIRED'), true);
    assert.equal(isLegalInvoiceTransition('PENDING', 'PENDING'), false);
  });

  it('requires settlement proof for CANCELLED → PAID and EXPIRED → PAID', () => {
    assert.equal(isLegalInvoiceTransition('CANCELLED', 'PAID'), false);
    assert.equal(
      isLegalInvoiceTransition('CANCELLED', 'PAID', { settledAt: new Date() }),
      true
    );
    assert.equal(isLegalInvoiceTransition('EXPIRED', 'PAID'), false);
    assert.equal(
      isLegalInvoiceTransition('EXPIRED', 'PAID', { settledAt: '2026-03-01T00:00:00Z' }),
      true
    );
    assert.equal(isLegalInvoiceTransition('CANCELLED', 'CANCELLED'), false);
    assert.equal(isLegalInvoiceTransition('CANCELLED', 'EXPIRED'), false);
    assert.equal(isLegalInvoiceTransition('EXPIRED', 'CANCELLED'), false);
  });

  it('rejects all transitions out of PAID', () => {
    for (const status of INVOICE_STATUSES) {
      assert.equal(isLegalInvoiceTransition('PAID', status), false);
    }
  });

  it('enumerates the full legal matrix from the transition table', () => {
    const pairs: Array<[InvoiceStatus, InvoiceStatus]> = [];
    for (const from of INVOICE_STATUSES) {
      for (const to of INVOICE_STATUSES) {
        const legalWithoutProof = isLegalInvoiceTransition(from, to);
        const legalWithProof = isLegalInvoiceTransition(from, to, {
          settledAt: new Date(),
        });
        const listed = LEGAL_INVOICE_TRANSITIONS[from].includes(to);
        if (from === 'CANCELLED' || from === 'EXPIRED') {
          if (to === 'PAID') {
            assert.equal(legalWithoutProof, false);
            assert.equal(legalWithProof, true);
            assert.equal(listed, true);
          } else {
            assert.equal(legalWithoutProof, false);
            assert.equal(legalWithProof, false);
            assert.equal(listed, false);
          }
        } else if (from === 'PENDING') {
          assert.equal(legalWithoutProof, listed);
          assert.equal(legalWithProof, listed);
        } else {
          assert.equal(legalWithoutProof, false);
          assert.equal(legalWithProof, false);
          assert.equal(listed, false);
        }
        if (listed) pairs.push([from, to]);
      }
    }
    assert.deepEqual(pairs, [
      ['PENDING', 'PAID'],
      ['PENDING', 'EXPIRED'],
      ['PENDING', 'CANCELLED'],
      ['EXPIRED', 'PAID'],
      ['CANCELLED', 'PAID'],
    ]);
  });

  it('assertLegalInvoiceTransition throws IllegalStateTransitionError with stable codes', () => {
    assert.throws(
      () => assertLegalInvoiceTransition('PAID', 'CANCELLED'),
      (err: any) => {
        assert.equal(err instanceof IllegalStateTransitionError, true);
        assert.equal(err.code, 'INVOICE_ALREADY_PAID');
        assert.equal(err.fromStatus, 'PAID');
        assert.equal(err.toStatus, 'CANCELLED');
        return true;
      }
    );

    assert.throws(
      () => assertLegalInvoiceTransition('EXPIRED', 'CANCELLED'),
      (err: any) => {
        assert.equal(err instanceof IllegalStateTransitionError, true);
        assert.equal(err.code, 'INVOICE_EXPIRED');
        return true;
      }
    );

    assert.throws(
      () => assertLegalInvoiceTransition('CANCELLED', 'CANCELLED'),
      (err: any) => {
        assert.equal(err instanceof IllegalStateTransitionError, true);
        assert.equal(err.code, 'INVOICE_NOT_PENDING');
        return true;
      }
    );

    assert.throws(
      () => assertLegalInvoiceTransition('CANCELLED', 'PAID'),
      (err: any) => {
        assert.equal(err instanceof IllegalStateTransitionError, true);
        assert.equal(err.code, 'INVOICE_NOT_PENDING');
        return true;
      }
    );
  });
});

describe('Invoice lifecycle HTTP cancel guards (issue #443)', () => {
  it('cancelInvoice returns 400 with INVOICE_ALREADY_PAID when invoice is already PAID', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });

    const createRes = createMockResponse();
    await handlers.createInvoice(
      createMockRequest({
        body: {
          amount: 50,
          assetCode: 'XLM',
          sellerPublicKey: SELLER_KEY,
          expiresInDays: 7,
        },
      }),
      createRes
    );
    const invoiceId = createRes.body.data.invoice.id;

    await storage.markAsPaid(invoiceId, 'a'.repeat(64), PAYER_KEY, undefined, {
      settledAt: new Date(),
    });

    const cancelRes = createMockResponse();
    await handlers.cancelInvoice(
      createMockRequest({
        params: { id: invoiceId },
        body: { sellerPublicKey: SELLER_KEY },
      }),
      cancelRes
    );

    assert.equal(cancelRes.statusCode, 400);
    assert.equal(cancelRes.body.success, false);
    assert.equal(cancelRes.body.code, 'INVOICE_ALREADY_PAID');
  });

  it('cancelInvoice returns 400 with INVOICE_NOT_PENDING when invoice is already CANCELLED', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });

    const createRes = createMockResponse();
    await handlers.createInvoice(
      createMockRequest({
        body: {
          amount: 25,
          assetCode: 'XLM',
          sellerPublicKey: SELLER_KEY,
          expiresInDays: 7,
        },
      }),
      createRes
    );
    const invoiceId = createRes.body.data.invoice.id;

    const firstCancelRes = createMockResponse();
    await handlers.cancelInvoice(
      createMockRequest({
        params: { id: invoiceId },
        body: { sellerPublicKey: SELLER_KEY },
      }),
      firstCancelRes
    );
    assert.equal(firstCancelRes.statusCode, 200);

    const secondCancelRes = createMockResponse();
    await handlers.cancelInvoice(
      createMockRequest({
        params: { id: invoiceId },
        body: { sellerPublicKey: SELLER_KEY },
      }),
      secondCancelRes
    );

    assert.equal(secondCancelRes.statusCode, 400);
    assert.equal(secondCancelRes.body.success, false);
    assert.equal(secondCancelRes.body.code, 'INVOICE_NOT_PENDING');
  });

  it('cancelInvoice returns 400 with INVOICE_EXPIRED when invoice is EXPIRED', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });

    const createRes = createMockResponse();
    await handlers.createInvoice(
      createMockRequest({
        body: {
          amount: 10,
          assetCode: 'XLM',
          sellerPublicKey: SELLER_KEY,
          expiresInDays: 7,
        },
      }),
      createRes
    );
    const invoice = createRes.body.data.invoice;
    await storage.markExpiredInvoices(new Date(new Date(invoice.expiresAt).getTime() + 1000));

    const cancelRes = createMockResponse();
    await handlers.cancelInvoice(
      createMockRequest({
        params: { id: invoice.id },
        body: { sellerPublicKey: SELLER_KEY },
      }),
      cancelRes
    );

    assert.equal(cancelRes.statusCode, 400);
    assert.equal(cancelRes.body.success, false);
    assert.equal(cancelRes.body.code, 'INVOICE_EXPIRED');
  });

  it('cancelInvoice returns 404 when invoice does not exist', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });

    const cancelRes = createMockResponse();
    await handlers.cancelInvoice(
      createMockRequest({
        params: { id: '00000000-0000-0000-0000-000000000000' },
        body: { sellerPublicKey: SELLER_KEY },
      }),
      cancelRes
    );

    assert.equal(cancelRes.statusCode, 404);
    assert.equal(cancelRes.body.success, false);
    assert.equal(cancelRes.body.error, 'Invoice not found');
  });
});

describe('Invoice lifecycle storage matrix (issue #443)', () => {
  it('covers create → pay, create → cancel, and late pay after cancel', async () => {
    const storage = new MemoryInvoiceStorage();

    const paid = await storage.createInvoice({
      amount: 12,
      assetCode: 'XLM',
      sellerPublicKey: SELLER_KEY,
      expiresInDays: 7,
    } as any);
    const afterPay = await storage.markAsPaid(
      paid.id,
      'b'.repeat(64),
      PAYER_KEY,
      undefined,
      { settledAt: new Date() }
    );
    assert.equal(afterPay.status, 'PAID');

    await assert.rejects(
      () => storage.cancelInvoice(paid.id, SELLER_KEY),
      (err: any) => {
        assert.equal(err instanceof IllegalStateTransitionError, true);
        assert.equal(err.code, 'INVOICE_ALREADY_PAID');
        return true;
      }
    );

    const cancelled = await storage.createInvoice({
      amount: 18,
      assetCode: 'XLM',
      sellerPublicKey: SELLER_KEY,
      expiresInDays: 7,
    } as any);
    const afterCancel = await storage.cancelInvoice(cancelled.id, SELLER_KEY);
    assert.equal(afterCancel.status, 'CANCELLED');

    const late = await storage.markAsPaid(
      cancelled.id,
      'c'.repeat(64),
      PAYER_KEY,
      undefined,
      { settledAt: new Date(Date.now() + 1000) }
    );
    assert.equal(late.status, 'PAID');
    assert.equal(late.priorStatus, 'CANCELLED');
    assert.equal(late.settlementContext, 'AFTER_CANCEL');
  });
});
