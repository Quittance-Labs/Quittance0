import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import type { Request, Response } from 'express';
import {
  setLogSink,
  LogRecord,
  EVENT_FIELDS,
  logReference,
} from '../src/observability/log-events.ts';
import {
  correlationMiddleware,
  validateCorrelationId,
  createRequestId,
} from '../src/utils/request-correlation-id.ts';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers.ts';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage.ts';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service.ts';
import memoryStorage from '../src/storage/memory-storage.ts';
import { getQuittanceProof, getQuittanceProofPDF } from '../src/controllers/quittance-proof.controller.ts';

const SELLER = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const SECRET = 'SB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const PAYER = 'GCBIBQVH2B3STCBIYSMTQH6DWKSB2XUGLXH7RGPIN3OXPCFCIQEICVZ6';
const MEMO_TEXT = 'SECRET_MEMO_ORDER_99';
const CUSTOMER_EMAIL = 'customer@example.com';

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  status(code: number): MockResponse;
  json(data: any): MockResponse;
  send(data: any): MockResponse;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
}

function createMockRes(): MockResponse & Response {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
    send(data: any) {
      res.body = data;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    set(name: string, value: string) {
      res.setHeader(name, value);
      return res;
    },
    getHeader(name: string) {
      return res.headers[name.toLowerCase()];
    },
  };
  return res;
}

function createMockReq(options: {
  headers?: Record<string, string>;
  body?: any;
  params?: any;
  query?: any;
  app?: any;
} = {}): Request {
  return {
    headers: options.headers || {},
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
    app: options.app || { get: () => null },
  } as unknown as Request;
}

describe('Observability & Structured Event Suite', () => {
  let emittedLogs: LogRecord[] = [];
  let storage: MemoryInvoiceStorage;
  let memoryService: InvoiceMemoryService;

  beforeEach(() => {
    emittedLogs = [];
    setLogSink((record) => {
      emittedLogs.push(record);
    });
    memoryStorage.clear();
    memoryService = new InvoiceMemoryService(memoryStorage);
    storage = new MemoryInvoiceStorage(memoryService);
  });

  afterEach(() => {
    setLogSink(null);
  });

  describe('Correlation ID Middleware & Propagation', () => {
    it('propagates client-supplied X-Correlation-Id to response headers and request state', () => {
      const clientCorrelationId = 'client-cid-12345';
      const req = createMockReq({
        headers: { 'x-correlation-id': clientCorrelationId },
      });
      const res = createMockRes();

      let nextCalled = false;
      correlationMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
      assert.equal(res.getHeader('X-Correlation-Id'), clientCorrelationId);
      assert.equal(res.getHeader('X-Request-Id'), clientCorrelationId);
      assert.equal((req as any).id, clientCorrelationId);
    });

    it('falls back to client-supplied X-Request-Id when X-Correlation-Id is omitted', () => {
      const clientRequestId = 'client-req-98765';
      const req = createMockReq({
        headers: { 'x-request-id': clientRequestId },
      });
      const res = createMockRes();

      let nextCalled = false;
      correlationMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
      assert.equal(res.getHeader('X-Request-Id'), clientRequestId);
      assert.equal(res.getHeader('X-Correlation-Id'), clientRequestId);
      assert.equal((req as any).id, clientRequestId);
    });

    it('generates a fresh prefixed ID when incoming correlation ID is invalid or malicious', () => {
      const invalidHeader = '<script>alert(1)</script>';
      const req = createMockReq({
        headers: { 'x-correlation-id': invalidHeader },
      });
      const res = createMockRes();

      correlationMiddleware(req, res, () => {});

      const assignedId = res.getHeader('X-Correlation-Id') as string;
      assert.ok(assignedId.startsWith('req-'));
      assert.notEqual(assignedId, invalidHeader);
      assert.equal(validateCorrelationId(assignedId), assignedId);
    });
  });

  describe('End-to-End Event Chain: Create -> Pay -> Proof Download', () => {
    it('emits standard taxonomy events throughout invoice lifecycle with matching correlation ID', async () => {
      const handlers = createInvoiceHandlers({
        storage,
        allowSimulate: true,
      });

      const testCorrelationId = 'corr-e2e-session-abc';
      const app = { get: (name: string) => (name === 'invoiceStorage' ? storage : null) };

      // 1. Create Invoice
      const reqCreate = createMockReq({
        headers: { 'x-correlation-id': testCorrelationId },
        body: {
          sellerPublicKey: SELLER,
          amount: 50,
          assetCode: 'XLM',
          memo: MEMO_TEXT,
          customerEmail: CUSTOMER_EMAIL,
        },
        app,
      });
      const resCreate = createMockRes();

      await new Promise<void>((resolve) => {
        correlationMiddleware(reqCreate, resCreate, () => {
          void handlers.createInvoice(reqCreate, resCreate).then(() => resolve());
        });
      });

      assert.equal(resCreate.statusCode, 201);
      const invoiceId = resCreate.body?.data?.invoice?.id;
      assert.ok(invoiceId);

      // Verify create events
      const createStarted = emittedLogs.find((l) => l.event === 'invoice.create.started');
      const createSucceeded = emittedLogs.find((l) => l.event === 'invoice.create.succeeded');
      assert.ok(createStarted);
      assert.ok(createSucceeded);
      assert.equal(createStarted.requestId, testCorrelationId);
      assert.equal(createSucceeded.requestId, testCorrelationId);

      // 2. Simulate / Verify Payment
      const reqPay = createMockReq({
        headers: { 'x-correlation-id': testCorrelationId },
        params: { id: invoiceId },
        body: {
          txHash: '1'.repeat(64),
          sourceAccount: PAYER,
        },
        app,
      });
      const resPay = createMockRes();

      await new Promise<void>((resolve) => {
        correlationMiddleware(reqPay, resPay, () => {
          void handlers.simulatePayment(reqPay, resPay).then(() => resolve());
        });
      });

      assert.equal(resPay.statusCode, 200);

      // Verify payment events
      const attemptStarted = emittedLogs.find((l) => l.event === 'payment.attempt.started');
      const invoicePaid = emittedLogs.find((l) => l.event === 'invoice.paid');
      assert.ok(attemptStarted);
      assert.ok(invoicePaid);
      assert.equal(attemptStarted.requestId, testCorrelationId);
      assert.equal(invoicePaid.requestId, testCorrelationId);

      // 3. Proof Download (JSON format)
      const reqProof = createMockReq({
        headers: { 'x-correlation-id': testCorrelationId },
        params: { id: invoiceId },
        app,
      });
      const resProof = createMockRes();

      await new Promise<void>((resolve) => {
        correlationMiddleware(reqProof, resProof, () => {
          void getQuittanceProof(reqProof, resProof).then(() => resolve());
        });
      });

      assert.equal(resProof.statusCode, 200);

      // 4. Proof Download (PDF format)
      const reqPdf = createMockReq({
        headers: { 'x-correlation-id': testCorrelationId },
        params: { id: invoiceId },
        app,
      });
      const resPdf = createMockRes();

      await new Promise<void>((resolve) => {
        correlationMiddleware(reqPdf, resPdf, () => {
          void getQuittanceProofPDF(reqPdf, resPdf).then(() => resolve());
        });
      });

      assert.equal(resPdf.statusCode, 200);

      // Verify proof events
      const proofEvents = emittedLogs.filter((l) => l.event === 'proof.downloaded');
      assert.equal(proofEvents.length, 2);
      assert.equal(proofEvents[0].proofFormat, 'json');
      assert.equal(proofEvents[1].proofFormat, 'pdf');
      assert.equal(proofEvents[0].requestId, testCorrelationId);
      assert.equal(proofEvents[1].requestId, testCorrelationId);
    });

    it('ensures all emitted events strictly adhere to allowed fields taxonomy', async () => {
      const handlers = createInvoiceHandlers({
        storage,
        allowSimulate: true,
      });

      const req = createMockReq({
        body: {
          sellerPublicKey: SELLER,
          amount: 25,
          assetCode: 'XLM',
        },
      });
      const res = createMockRes();

      await handlers.createInvoice(req, res);

      const standardContextKeys = new Set(['timestamp', 'level', 'event', 'requestId', 'service', 'environment']);

      for (const log of emittedLogs) {
        const allowedArr = EVENT_FIELDS[log.event];
        assert.ok(allowedArr, `Unknown event was emitted: ${log.event}`);
        const allowedSet = new Set(allowedArr);

        for (const key of Object.keys(log)) {
          if (standardContextKeys.has(key)) continue;
          assert.ok(
            allowedSet.has(key),
            `Field "${key}" is not permitted in event "${log.event}"`
          );
        }
      }
    });
  });

  describe('Reject vs Downstream Outage Distinction', () => {
    it('distinguishes business rejection from Horizon downstream outage', async () => {
      // 1. Business rejection: invalid hash format
      const mockStellarSuccess = {
        getTransaction: async () => {
          return {
            id: 'valid',
            memo: 'valid',
            memo_type: 'text',
            envelope_xdr: '',
          } as any;
        },
      };

      const handlers = createInvoiceHandlers({
        storage,
        stellar: mockStellarSuccess,
      });

      const inv = await storage.createInvoice({
        sellerPublicKey: SELLER,
        amount: 10,
        assetCode: 'XLM',
      });

      const reqInvalidHash = createMockReq({
        params: { id: inv.id },
        body: { txHash: 'short-hash' },
      });
      const resInvalidHash = createMockRes();

      await handlers.verifyPayment(reqInvalidHash, resInvalidHash);
      assert.equal(resInvalidHash.statusCode, 400);

      const rejectEvent = emittedLogs.find((l) => l.event === 'payment.verify.rejected');
      assert.ok(rejectEvent);
      assert.equal(rejectEvent.errorCode, 'INVALID_TX_HASH');
      assert.equal(rejectEvent.level, 'warn');

      // 2. Downstream outage: network failure (e.g. 503 / timeout)
      const mockStellarOutage = {
        getTransaction: async () => {
          const err: any = new Error('getaddrinfo ENOTFOUND horizon-testnet.stellar.org');
          err.response = { status: 503 };
          throw err;
        },
      };

      const outageHandlers = createInvoiceHandlers({
        storage,
        stellar: mockStellarOutage,
      });

      emittedLogs = [];
      const reqOutage = createMockReq({
        params: { id: inv.id },
        body: { txHash: 'e'.repeat(64) },
      });
      const resOutage = createMockRes();

      await outageHandlers.verifyPayment(reqOutage, resOutage);
      assert.equal(resOutage.statusCode, 503);

      const outageEvent = emittedLogs.find((l) => l.event === 'horizon.request.failed');
      assert.ok(outageEvent, 'Must emit horizon.request.failed on downstream network outage');
      assert.equal(outageEvent.level, 'error');
      assert.equal(outageEvent.operation, 'getTransaction');
      assert.equal(outageEvent.errorCode, 'HORIZON_UNAVAILABLE');
    });
  });

  describe('Privacy & Redaction Guarantees', () => {
    it('contains zero raw secrets, raw public keys, customer emails, or raw memos in emitted logs', async () => {
      const handlers = createInvoiceHandlers({
        storage,
        allowSimulate: true,
      });

      const req = createMockReq({
        body: {
          sellerPublicKey: SELLER,
          amount: 10,
          assetCode: 'XLM',
          memo: MEMO_TEXT,
          customerEmail: CUSTOMER_EMAIL,
          secretKey: SECRET,
        },
      });
      const res = createMockRes();

      await handlers.createInvoice(req, res);

      const allLogsJson = JSON.stringify(emittedLogs);

      assert.equal(allLogsJson.includes(SECRET), false, 'Raw secret key must never appear in logs');
      assert.equal(allLogsJson.includes(SELLER), false, 'Raw Stellar public key must never appear in logs');
      assert.equal(allLogsJson.includes(CUSTOMER_EMAIL), false, 'Raw customer email must never appear in logs');
      assert.equal(allLogsJson.includes(MEMO_TEXT), false, 'Raw memo must never appear in logs');

      const createSucceeded = emittedLogs.find((l) => l.event === 'invoice.create.succeeded');
      assert.ok(createSucceeded);
      assert.equal(createSucceeded.sellerRef, logReference(SELLER));
      assert.notEqual(createSucceeded.sellerRef, SELLER);
    });
  });
});
