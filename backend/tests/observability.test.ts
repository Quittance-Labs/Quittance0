import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import type { Request, Response, NextFunction } from 'express';
import {
  emitEvent,
  setLogSink,
  requiredLogFields,
  LOG_EVENTS,
  logReference,
  type StructuredLogRecord,
} from '../src/observability/log-events.ts';
import {
  createRequestId,
  getRequestId,
  runWithRequestId,
  parseRequestIdHeader,
  requestCorrelationMiddleware,
} from '../src/utils/request-correlation-id.ts';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers.ts';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage.ts';

const SELLER = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const OTHER_SELLER = 'GB6IHEZ4QNOHJZRYRFLOC45P4SK3KKL6KNPI5WEG6FNVSZ2K5FS2MNY7';
const TX_HASH = 'a'.repeat(64);

interface FakeResponse extends Response {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
}

function createRes(): FakeResponse {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[String(name).toLowerCase()] = String(value);
    },
    set(name: string, value: string) {
      res.setHeader(name, value);
      return res;
    },
    getHeader(name: string) {
      return res.headers[String(name).toLowerCase()];
    },
  };
  return res;
}

function createReq(init: {
  body?: any;
  params?: any;
  query?: any;
  headers?: Record<string, string>;
} = {}): Request {
  return {
    body: init.body || {},
    params: init.params || {},
    query: init.query || {},
    headers: init.headers || {},
  } as unknown as Request;
}

describe('MVP observability (#449)', () => {
  let records: StructuredLogRecord[];

  beforeEach(() => {
    records = [];
    setLogSink((record) => {
      records.push(record);
    });
    process.env.LOG_FINGERPRINT_KEY = 'test-fingerprint-key';
  });

  afterEach(() => {
    setLogSink(null);
    delete process.env.LOG_FINGERPRINT_KEY;
  });

  it('keeps the shared event taxonomy stable for monitor and verify', () => {
    assert.deepEqual([...LOG_EVENTS], [
      'invoice.create.started',
      'invoice.create.succeeded',
      'invoice.create.rejected',
      'payment.attempt.started',
      'payment.attempt.submitted',
      'payment.attempt.rejected',
      'payment.verify.started',
      'payment.verify.rejected',
      'invoice.paid',
      'proof.downloaded',
      'horizon.request.failed',
    ]);
  });

  it('accepts only req-<16 hex> inbound correlation ids', () => {
    assert.equal(parseRequestIdHeader('req-0123456789abcdef'), 'req-0123456789abcdef');
    assert.equal(parseRequestIdHeader('not-a-valid-id'), undefined);
    assert.equal(parseRequestIdHeader('req-ZZ'), undefined);
    assert.equal(parseRequestIdHeader('req-0123456789abcdef<script>'), undefined);
  });

  it('propagates a correlation id on the response and through AsyncLocalStorage', async () => {
    const req = createReq({ headers: { 'x-request-id': 'req-0123456789abcdef' } });
    const res = createRes();
    let seen: string | undefined;
    await new Promise<void>((resolve) => {
      requestCorrelationMiddleware(req, res, (() => {
        seen = getRequestId();
        resolve();
      }) as NextFunction);
    });
    assert.equal(seen, 'req-0123456789abcdef');
    assert.equal(res.headers['x-request-id'], 'req-0123456789abcdef');
    assert.equal((req as any).requestId, 'req-0123456789abcdef');
  });

  it('replaces unsafe inbound correlation ids with a server-generated id', async () => {
    const req = createReq({ headers: { 'x-request-id': 'attacker\nwallet=GFOREIGN' } });
    const res = createRes();
    await new Promise<void>((resolve) => {
      requestCorrelationMiddleware(req, res, (() => resolve()) as NextFunction);
    });
    const id = res.headers['x-request-id'];
    assert.match(id, /^req-[0-9a-f]{16}$/);
    assert.doesNotMatch(id, /GFOREIGN|\n/);
  });

  it('emits create reject with allow-listed fields only and no raw seller key', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });
    const req = createReq({
      body: {
        sellerPublicKey: SELLER,
        assetCode: 'XLM',
      },
    });
    (req as any).requestId = 'req-aaaaaaaaaaaaaaaa';
    await handlers.createInvoice(req, createRes());

    const rejected = records.filter((r) => r.event === 'invoice.create.rejected');
    assert.ok(rejected.length >= 1);
    for (const record of rejected) {
      assert.equal(record.requestId, 'req-aaaaaaaaaaaaaaaa');
      for (const key of Object.keys(record)) {
        if (['timestamp', 'level', 'event', 'requestId', 'service', 'environment'].includes(key)) {
          continue;
        }
        assert.ok(
          requiredLogFields(record.event).includes(key),
          `unexpected field ${key} on ${record.event}`
        );
      }
      assert.equal((record as any).sellerPublicKey, undefined);
      assert.equal((record as any).memo, undefined);
      assert.equal((record as any).customerEmail, undefined);
      assert.doesNotMatch(JSON.stringify(record), new RegExp(SELLER));
      assert.doesNotMatch(JSON.stringify(record), new RegExp(OTHER_SELLER));
    }
  });

  it('emits create started/succeeded with one requestId and redacted refs', async () => {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({ storage });
    const req = createReq({
      body: {
        amount: 12.5,
        assetCode: 'XLM',
        sellerPublicKey: SELLER,
        expiresInDays: 7,
      },
    });
    (req as any).requestId = 'req-bbbbbbbbbbbbbbbb';
    const res = createRes();
    await handlers.createInvoice(req, res);
    assert.ok(res.statusCode === 201 || res.statusCode === 200);

    const started = records.find((r) => r.event === 'invoice.create.started');
    const succeeded = records.find((r) => r.event === 'invoice.create.succeeded');
    assert.ok(started, 'expected invoice.create.started');
    assert.ok(succeeded, 'expected invoice.create.succeeded');
    assert.equal(started!.requestId, 'req-bbbbbbbbbbbbbbbb');
    assert.equal(succeeded!.requestId, 'req-bbbbbbbbbbbbbbbb');
    assert.equal(started!.network, succeeded!.network);
    assert.match(String(succeeded!.invoiceRef), /^[0-9a-f]{16}$/);
    assert.doesNotMatch(JSON.stringify(records), new RegExp(SELLER));
    assert.doesNotMatch(JSON.stringify(records), new RegExp(OTHER_SELLER));
  });

  it('emits distinct verify reject vs horizon outage events', async () => {
    const storage = new MemoryInvoiceStorage();
    const created = await storage.createInvoice({
      amount: 5,
      assetCode: 'XLM',
      sellerPublicKey: SELLER,
      expiresInDays: 3,
    } as any);

    const handlers = createInvoiceHandlers({
      storage,
      stellar: {
        async getTransaction() {
          const err: any = new Error('horizon down');
          err.response = { status: 503 };
          throw err;
        },
      },
    });

    records = [];
    const badReq = createReq({
      params: { id: created.id },
      body: { txHash: 'nope' },
    });
    (badReq as any).requestId = 'req-cccccccccccccccc';
    await handlers.verifyPayment(badReq, createRes());
    const rejected = records.filter((r) => r.event === 'payment.verify.rejected');
    assert.ok(rejected.length >= 1, 'expected payment.verify.rejected');
    assert.ok(rejected.every((r) => r.requestId === 'req-cccccccccccccccc'));
    assert.doesNotMatch(JSON.stringify(rejected), new RegExp(OTHER_SELLER));

    records = [];
    const outageReq = createReq({
      params: { id: created.id },
      body: { txHash: TX_HASH },
    });
    (outageReq as any).requestId = 'req-dddddddddddddddd';
    await handlers.verifyPayment(outageReq, createRes());
    const outages = records.filter((r) => r.event === 'horizon.request.failed');
    const verifyRejects = records.filter((r) => r.event === 'payment.verify.rejected');
    assert.ok(outages.length >= 1, 'expected horizon.request.failed for outage');
    assert.equal(outages[0].errorCode, 'HORIZON_UNAVAILABLE');
    assert.equal(outages[0].requestId, 'req-dddddddddddddddd');
    assert.ok(
      verifyRejects.every((r) => r.errorCode !== 'HORIZON_UNAVAILABLE'),
      'outage must stay distinct from payment.verify.rejected'
    );
    assert.doesNotMatch(JSON.stringify(records), new RegExp(OTHER_SELLER));
    assert.doesNotMatch(JSON.stringify(records), new RegExp(SELLER));
  });

  it('runWithRequestId isolates monitor-style correlators', () => {
    const outer = createRequestId();
    runWithRequestId(outer, () => {
      assert.equal(getRequestId(), outer);
      const inner = createRequestId();
      runWithRequestId(inner, () => {
        assert.equal(getRequestId(), inner);
        emitEvent(
          'info',
          'payment.verify.started',
          { requestId: inner, service: 'api', environment: 'test' },
          {
            invoiceRef: logReference('inv-1'),
            txRef: logReference(TX_HASH),
            network: 'TESTNET',
          }
        );
      });
      assert.equal(getRequestId(), outer);
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].event, 'payment.verify.started');
    assert.match(String(records[0].requestId), /^req-[0-9a-f]{16}$/);
    assert.doesNotMatch(JSON.stringify(records[0]), new RegExp(TX_HASH));
  });
});
