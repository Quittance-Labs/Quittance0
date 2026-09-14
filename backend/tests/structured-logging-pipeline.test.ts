import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import type { Request, Response } from 'express';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import {
  setLogSink,
  StructuredLogRecord,
  logReference,
  requiredLogFields,
} from '../src/observability/log-events';
import {
  correlationMiddleware,
  REQUEST_ID_HEADER,
} from '../src/middleware/correlation-id';
import { STELLAR_NETWORK } from '../src/config/stellar';

const SELLER_A = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const PAYER_A = 'GCBIBQVH2B3STCBIYSMTQH6DWKSB2XUGLXH7RGPIN3OXPCFCIQEICVZ6';
const VALID_TX_HASH = 'a'.repeat(64);

interface FakeResponse {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  status(code: number): FakeResponse & Response;
  json(payload: any): FakeResponse & Response;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
}

function createRes(): FakeResponse & Response {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
  };
  return res;
}

function createReq(init: { body?: any; params?: any; query?: any; requestId?: string } = {}): Request {
  const req: any = {
    body: init.body || {},
    params: init.params || {},
    query: init.query || {},
    requestId: init.requestId,
  };
  return req as Request;
}

async function call(
  handler: (req: Request, res: Response) => Promise<void>,
  req: Request
): Promise<FakeResponse> {
  const res = createRes();
  await handler(req, res);
  return res;
}

describe('structured logging pipeline end-to-end', () => {
  let emittedLogs: StructuredLogRecord[] = [];
  const testKey = 'test-audit-fingerprint-key-12345';

  beforeEach(() => {
    emittedLogs = [];
    process.env.LOG_FINGERPRINT_KEY = testKey;
    setLogSink((record) => {
      emittedLogs.push(record);
    });
  });

  afterEach(() => {
    setLogSink(null);
    delete process.env.LOG_FINGERPRINT_KEY;
  });

  it('correlation middleware attaches request ID and sets response header', () => {
    const req = createReq();
    const res = createRes();
    let nextCalled = false;

    correlationMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.match(req.requestId || '', /^req-[a-f0-9]{16}$/);
    assert.equal(res.getHeader(REQUEST_ID_HEADER), req.requestId);
  });

  it('correlation middleware preserves pre-existing requestId', () => {
    const existingId = 'req-custom12345678';
    const req = createReq({ requestId: existingId });
    const res = createRes();

    correlationMiddleware(req, res, () => {});

    assert.equal(req.requestId, existingId);
    assert.equal(res.getHeader(REQUEST_ID_HEADER), existingId);
  });

  it('emits invoice.create.started and invoice.create.succeeded on creation', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });

    const req = createReq({
      requestId: 'req-create-001',
      body: {
        amount: 10.5,
        sellerPublicKey: SELLER_A,
        description: 'Monthly service invoice',
        assetCode: 'XLM',
      },
    });

    const res = await call(handlers.createInvoice, req);
    assert.equal(res.statusCode, 201);

    const invoiceLogs = emittedLogs.filter(
      (l) => l.event === 'invoice.create.started' || l.event === 'invoice.create.succeeded'
    );
    assert.equal(invoiceLogs.length, 2);

    const [started, succeeded] = invoiceLogs;
    assert.equal(started.event, 'invoice.create.started');
    assert.equal(started.level, 'info');
    assert.equal(started.requestId, 'req-create-001');
    assert.equal(started.sellerRef, logReference(SELLER_A, testKey));
    assert.equal(started.assetCode, 'XLM');
    assert.equal(started.network, STELLAR_NETWORK);
    assert.equal(started.storage, 'in-memory');

    assert.equal(succeeded.event, 'invoice.create.succeeded');
    assert.equal(succeeded.level, 'info');
    assert.equal(succeeded.requestId, 'req-create-001');
    assert.equal(succeeded.sellerRef, logReference(SELLER_A, testKey));
    assert.equal(succeeded.invoiceRef, logReference(res.body.data.invoice.id, testKey));
    assert.equal(succeeded.assetCode, 'XLM');
    assert.equal(typeof succeeded.durationMs, 'number');

    for (const record of invoiceLogs) {
      const allowed = new Set([...requiredLogFields(record.event), 'timestamp', 'level', 'event', 'requestId', 'service', 'environment']);
      for (const key of Object.keys(record)) {
        assert.equal(allowed.has(key), true, `Unexpected key ${key} in structured log`);
      }
    }
  });

  it('emits invoice.create.rejected on invalid request payload', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });

    const req = createReq({
      requestId: 'req-create-bad',
      body: {
        amount: 'invalid-amount',
        sellerPublicKey: SELLER_A,
      },
    });

    const res = await call(handlers.createInvoice, req);
    assert.equal(res.statusCode, 400);

    const rejectedLogs = emittedLogs.filter((l) => l.event === 'invoice.create.rejected');
    assert.equal(rejectedLogs.length, 1);

    const rejected = rejectedLogs[0];
    assert.equal(rejected.level, 'warn');
    assert.equal(rejected.requestId, 'req-create-bad');
    assert.equal(rejected.sellerRef, logReference(SELLER_A, testKey));
    assert.equal(rejected.errorCode, 'VALIDATION_ERROR');
    assert.equal(typeof rejected.durationMs, 'number');
  });

  it('emits payment.verify.rejected when txHash is invalid', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });

    const req = createReq({
      requestId: 'req-verify-invalid-hash',
      params: { id: 'inv-123' },
      body: { txHash: 'short-hash' },
    });

    const res = await call(handlers.verifyPayment, req);
    assert.equal(res.statusCode, 400);

    const rejectedLogs = emittedLogs.filter((l) => l.event === 'payment.verify.rejected');
    assert.equal(rejectedLogs.length, 1);

    const rejected = rejectedLogs[0];
    assert.equal(rejected.level, 'warn');
    assert.equal(rejected.requestId, 'req-verify-invalid-hash');
    assert.equal(rejected.invoiceRef, logReference('inv-123', testKey));
    assert.equal(rejected.errorCode, 'INVALID_TX_HASH');
  });

  it('emits payment.verify.started and invoice.paid upon successful settlement', async () => {
    const storage = new MemoryInvoiceStorage();
    const invoice = await storage.createInvoice({
      amount: '5.00',
      sellerPublicKey: SELLER_A,
      assetCode: 'XLM',
    });

    const mockStellar = {
      async getTransaction(txHash: string) {
        return {
          transaction: {
            memo: invoice.memo,
            successful: true,
          },
          operations: [
            {
              type: 'payment',
              from: PAYER_A,
              to: SELLER_A,
              amount: '5.0000000',
              asset_type: 'native',
              created_at: new Date().toISOString(),
            },
          ],
        };
      },
    };

    const handlers = createInvoiceHandlers({
      storage,
      stellar: mockStellar as any,
    });

    const req = createReq({
      requestId: 'req-verify-paid',
      params: { id: invoice.id },
      body: { txHash: VALID_TX_HASH },
    });

    const res = await call(handlers.verifyPayment, req);
    assert.equal(res.statusCode, 200);

    const started = emittedLogs.find((l) => l.event === 'payment.verify.started');
    assert.ok(started);
    assert.equal(started.requestId, 'req-verify-paid');
    assert.equal(started.invoiceRef, logReference(invoice.id, testKey));
    assert.equal(started.txRef, logReference(VALID_TX_HASH, testKey));

    const paid = emittedLogs.find((l) => l.event === 'invoice.paid');
    assert.ok(paid);
    assert.equal(paid.level, 'info');
    assert.equal(paid.requestId, 'req-verify-paid');
    assert.equal(paid.invoiceRef, logReference(invoice.id, testKey));
    assert.equal(paid.sellerRef, logReference(SELLER_A, testKey));
    assert.equal(paid.txRef, logReference(VALID_TX_HASH, testKey));
    assert.equal(paid.assetCode, 'XLM');
    assert.equal(paid.network, STELLAR_NETWORK);
    assert.equal(typeof paid.durationMs, 'number');
  });

  it('never leaks raw public keys, secrets, memos, or PII into log records', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });

    const sensitiveMemo = 'Confidential Patient Invoice #98765';
    const req = createReq({
      requestId: 'req-privacy-check',
      body: {
        amount: 25.0,
        sellerPublicKey: SELLER_A,
        description: sensitiveMemo,
      },
    });

    await call(handlers.createInvoice, req);

    for (const record of emittedLogs) {
      const recordString = JSON.stringify(record);
      assert.equal(recordString.includes(SELLER_A), false, 'Raw seller public key must not appear in log');
      assert.equal(recordString.includes(sensitiveMemo), false, 'Sensitive description must not appear in log');
      assert.equal(recordString.includes('secret'), false);
      assert.equal(recordString.includes('seed'), false);
    }
  });
});
