import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INVOICE_STATUSES,
  LEGAL_INVOICE_TRANSITIONS,
  IllegalStateTransitionError,
  assertLegalInvoiceTransition,
  isLegalInvoiceTransition,
  isTerminalInvoiceStatus,
} from '../src/domain/invoice-lifecycle';
import type { InvoiceStatus } from '../src/domain/invoice-lifecycle';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';

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

function createMockRequest(options: { params?: Record<string, string>; body?: Record<string, unknown> } = {}): any {
  return {
    params: options.params ?? {},
    body: options.body ?? {},
    query: {},
  };
}

describe('Invoice State Machine Domain Transitions', () => {
  it('classifies terminal statuses correctly', () => {
    assert.equal(isTerminalInvoiceStatus('PAID'), true);
    assert.equal(isTerminalInvoiceStatus('EXPIRED'), true);
    assert.equal(isTerminalInvoiceStatus('CANCELLED'), false);
    assert.equal(isTerminalInvoiceStatus('PENDING'), false);
  });

  it('permits valid transitions from PENDING', () => {
    assert.equal(isLegalInvoiceTransition('PENDING', 'PAID'), true);
    assert.equal(isLegalInvoiceTransition('PENDING', 'CANCELLED'), true);
    assert.equal(isLegalInvoiceTransition('PENDING', 'EXPIRED'), true);
    assert.equal(isLegalInvoiceTransition('PENDING', 'PENDING'), false);
  });

  it('enforces proof requirement for CANCELLED to PAID transition', () => {
    assert.equal(isLegalInvoiceTransition('CANCELLED', 'PAID'), false);
    assert.equal(isLegalInvoiceTransition('CANCELLED', 'PAID', { settledAt: new Date() }), true);
    assert.equal(isLegalInvoiceTransition('CANCELLED', 'PAID', { settledAt: '2026-03-01T00:00:00Z' }), true);
    assert.equal(isLegalInvoiceTransition('CANCELLED', 'CANCELLED'), false);
    assert.equal(isLegalInvoiceTransition('CANCELLED', 'EXPIRED'), false);
  });

  it('rejects all transitions out of PAID', () => {
    for (const status of INVOICE_STATUSES) {
      assert.equal(isLegalInvoiceTransition('PAID', status), false);
    }
  });

  it('rejects all transitions out of EXPIRED', () => {
    for (const status of INVOICE_STATUSES) {
      assert.equal(isLegalInvoiceTransition('EXPIRED', status), false);
    }
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
      () => assertLegalInvoiceTransition('EXPIRED', 'PAID'),
      (err: any) => {
        assert.equal(err instanceof IllegalStateTransitionError, true);
        assert.equal(err.code, 'INVOICE_EXPIRED');
        assert.equal(err.fromStatus, 'EXPIRED');
        assert.equal(err.toStatus, 'PAID');
        return true;
      }
    );

    assert.throws(
      () => assertLegalInvoiceTransition('CANCELLED', 'CANCELLED'),
      (err: any) => {
        assert.equal(err instanceof IllegalStateTransitionError, true);
        assert.equal(err.code, 'INVOICE_NOT_PENDING');
        assert.equal(err.fromStatus, 'CANCELLED');
        assert.equal(err.toStatus, 'CANCELLED');
        return true;
      }
    );
  });
});

describe('Invoice State Machine HTTP Handler Guards', () => {
  it('cancelInvoice returns 400 with INVOICE_ALREADY_PAID when invoice is already PAID', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });

    const createReq = createMockRequest({
      body: {
        amount: 50,
        assetCode: 'XLM',
        sellerPublicKey: SELLER_KEY,
        expiresInDays: 7,
      },
    });
    const createRes = createMockResponse();
    await handlers.createInvoice(createReq, createRes);
    const invoiceId = createRes.body.data.invoice.id;

    await storage.markAsPaid(invoiceId, 'a'.repeat(64), PAYER_KEY);

    const cancelReq = createMockRequest({
      params: { id: invoiceId },
      body: { sellerPublicKey: SELLER_KEY },
    });
    const cancelRes = createMockResponse();
    await handlers.cancelInvoice(cancelReq, cancelRes);

    assert.equal(cancelRes.statusCode, 400);
    assert.equal(cancelRes.body.success, false);
    assert.equal(cancelRes.body.code, 'INVOICE_ALREADY_PAID');
  });

  it('cancelInvoice returns 400 with INVOICE_NOT_PENDING when invoice is already CANCELLED', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });

    const createReq = createMockRequest({
      body: {
        amount: 25,
        assetCode: 'XLM',
        sellerPublicKey: SELLER_KEY,
        expiresInDays: 7,
      },
    });
    const createRes = createMockResponse();
    await handlers.createInvoice(createReq, createRes);
    const invoiceId = createRes.body.data.invoice.id;

    const cancelReq = createMockRequest({
      params: { id: invoiceId },
      body: { sellerPublicKey: SELLER_KEY },
    });
    const firstCancelRes = createMockResponse();
    await handlers.cancelInvoice(cancelReq, firstCancelRes);
    assert.equal(firstCancelRes.statusCode, 200);

    const secondCancelRes = createMockResponse();
    await handlers.cancelInvoice(cancelReq, secondCancelRes);

    assert.equal(secondCancelRes.statusCode, 400);
    assert.equal(secondCancelRes.body.success, false);
    assert.equal(secondCancelRes.body.code, 'INVOICE_NOT_PENDING');
  });

  it('cancelInvoice returns 404 when invoice does not exist', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });

    const cancelReq = createMockRequest({
      params: { id: '00000000-0000-0000-0000-000000000000' },
      body: { sellerPublicKey: SELLER_KEY },
    });
    const cancelRes = createMockResponse();
    await handlers.cancelInvoice(cancelReq, cancelRes);

    assert.equal(cancelRes.statusCode, 404);
    assert.equal(cancelRes.body.success, false);
    assert.equal(cancelRes.body.error, 'Invoice not found');
  });
});
