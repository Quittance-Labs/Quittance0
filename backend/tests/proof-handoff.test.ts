import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import cors from 'cors';
import { corsOptions } from '../src/config/runtime';
import { createInvoiceRouter } from '../src/routes/invoice.routes';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { MemoryStorage } from '../src/storage/memory-storage';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { requestCorrelationMiddleware } from '../src/utils/request-correlation-id';
import { requestLoggingMiddleware } from '../src/observability/request-logging';
import { logReference, setLogSink, type StructuredLogRecord } from '../src/observability/log-events';
import { defaultLimiterStore } from '../src/middleware/rate-limit';

const SELLER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const PAYER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const TX_HASH = 'b'.repeat(64);
const REQUEST_ID = 'req-0123456789abcdef';
const PRINT_HANDOFF = { proofFormat: 'pdf', handoff: 'print-window' };

describe('mounted browser proof handoff observation', () => {
  let storage: MemoryInvoiceStorage;
  let server: Server;
  let apiUrl: string;
  let records: StructuredLogRecord[];
  let lookupCount: number;
  let memo: string;
  let fingerprintKey: string | undefined;
  const consoleMethods = { log: console.log, warn: console.warn, error: console.error };

  beforeEach(async () => {
    fingerprintKey = process.env.LOG_FINGERPRINT_KEY;
    process.env.LOG_FINGERPRINT_KEY = 'proof-handoff-test-key';
    records = [];
    lookupCount = 0;
    setLogSink((record) => records.push(record));
    console.log = console.warn = console.error = () => {};
    defaultLimiterStore.reset();
    storage = new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage()));
    const app = express();
    app.use(cors(corsOptions({ NODE_ENV: 'test', FRONTEND_URL: 'https://app.example.invalid' })));
    app.use(requestCorrelationMiddleware);
    app.use(requestLoggingMiddleware);
    app.use(express.json({ limit: '16kb' }));
    app.use('/api', createInvoiceRouter({
      storage,
      enableRateLimiting: true,
      enableConcurrencyLock: false,
      enableCeilingCheck: false,
      enableVerifyCache: false,
      stellar: {
        async getTransaction() {
          lookupCount += 1;
          return {
            transaction: { successful: true, memo, memo_type: 'text', created_at: new Date().toISOString() },
            operations: [{ type: 'payment', from: PAYER, to: SELLER, amount: '25.0000000', asset_type: 'native' }],
          };
        },
      },
    }));
    app.use((error: any, _req: any, res: any, _next: any) => {
      res.status(error.code === 'CORS_ORIGIN_DENIED' ? 403 : 500).json({ success: false });
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as any).port}/api`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setLogSink(null);
    defaultLimiterStore.reset();
    Object.assign(console, consoleMethods);
    if (fingerprintKey === undefined) delete process.env.LOG_FINGERPRINT_KEY;
    else process.env.LOG_FINGERPRINT_KEY = fingerprintKey;
  });

  async function request(path: string, body: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': REQUEST_ID, ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as any };
  }

  async function createPaidInvoice() {
    const created = await storage.createInvoice({ amount: 25, assetCode: 'XLM', sellerPublicKey: SELLER, expiresInDays: 1 } as any);
    return storage.markAsPaid(created.id, TX_HASH, PAYER, undefined, { settledAt: new Date() });
  }

  it('correlates the HTTP create, verified payment and observed handoff using stored references', async () => {
    const created = await request('/invoices', { amount: 25, assetCode: 'XLM', sellerPublicKey: SELLER, expiresInDays: 1 });
    assert.equal(created.status, 201);
    const invoice = created.body.data.invoice;
    memo = invoice.memo;
    const paid = await request(`/invoices/${invoice.id}/verify`, { txHash: TX_HASH, network: 'TESTNET' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.data.status, 'PAID');
    const before = JSON.stringify(await storage.getInvoiceById(invoice.id));
    const response = await request(`/invoices/${invoice.id}/proof-handoff`, PRINT_HANDOFF);
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, { success: true, data: { accepted: true } });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-request-id'), REQUEST_ID);
    assert.equal(JSON.stringify(await storage.getInvoiceById(invoice.id)), before);
    assert.equal(lookupCount, 1, 'the observation must not query Horizon');
    for (const event of ['invoice.create.succeeded', 'invoice.paid', 'proof.handoff']) {
      const record = records.find((entry) => entry.event === event)!;
      assert.ok(record, `missing ${event}`);
      assert.equal(record.requestId, REQUEST_ID);
      assert.equal(record.invoiceRef, logReference(invoice.id));
    }
    const handoff = records.find((entry) => entry.event === 'proof.handoff')!;
    assert.equal(handoff.txRef, logReference(TX_HASH));
    assert.equal(handoff.proofFormat, 'pdf');
    assert.equal(handoff.handoff, 'print-window');
    assert.ok(records.some((entry) => entry.event === 'http.request.completed' && entry.route === '/invoices/:id/proof-handoff' && entry.requestId === REQUEST_ID));
    for (const marker of [invoice.id, invoice.memo, SELLER, PAYER, TX_HASH]) {
      assert.ok(!JSON.stringify(records).includes(marker), 'logs must contain only keyed references');
    }
  });

  it('records TXT dispatch separately and fails closed to redacted references without a key', async () => {
    const invoice = await createPaidInvoice();
    delete process.env.LOG_FINGERPRINT_KEY;
    const response = await request(`/invoices/${invoice.id}/proof-handoff`, { proofFormat: 'text', handoff: 'download' });
    assert.equal(response.status, 202);
    const handoff = records.find((entry) => entry.event === 'proof.handoff')!;
    assert.equal(handoff.invoiceRef, 'redacted');
    assert.equal(handoff.txRef, 'redacted');
    assert.equal(handoff.handoff, 'download');
    assert.equal(handoff.proofFormat, 'text');
    assert.equal(lookupCount, 0);
  });

  it('rejects caller references, status, contents and unsupported action pairs before logging', async () => {
    const invoice = await createPaidInvoice();
    for (const body of [
      { ...PRINT_HANDOFF, invoiceRef: 'forged', txHash: TX_HASH, status: 'PAID' },
      { ...PRINT_HANDOFF, proof: 'customer@example.invalid' },
      { proofFormat: 'pdf', handoff: 'download' },
      { proofFormat: 'json', handoff: 'download' },
      { proofFormat: 'text', handoff: 'print-window' },
      [],
      {},
    ]) {
      assert.equal((await request(`/invoices/${invoice.id}/proof-handoff`, body)).status, 400);
    }
    assert.equal(records.filter((entry) => entry.event === 'proof.handoff').length, 0);
  });

  for (const state of ['PENDING', 'EXPIRED', 'CANCELLED']) {
    it(`does not observe a proof for a stored ${state} invoice`, async () => {
      const invoice = await storage.createInvoice({ amount: 25, sellerPublicKey: SELLER, expiresInDays: 1 } as any);
      if (state === 'EXPIRED') await storage.markExpiredInvoices(new Date(Date.now() + 2 * 86400000));
      if (state === 'CANCELLED') await storage.cancelInvoice(invoice.id, SELLER);
      const before = JSON.stringify(await storage.getInvoiceById(invoice.id));
      assert.equal((await request(`/invoices/${invoice.id}/proof-handoff`, PRINT_HANDOFF)).status, 409);
      assert.equal(JSON.stringify(await storage.getInvoiceById(invoice.id)), before);
      assert.equal(records.filter((entry) => entry.event === 'proof.handoff').length, 0);
    });
  }

  it('does not emit an observation for a missing invoice or failed storage read', async () => {
    assert.equal((await request('/invoices/missing/proof-handoff', PRINT_HANDOFF)).status, 404);
    storage.getInvoiceById = async () => { throw new Error('private-query customer@example.invalid'); };
    const failed = await request('/invoices/missing/proof-handoff', PRINT_HANDOFF);
    assert.equal(failed.status, 503);
    assert.equal(records.filter((entry) => entry.event === 'proof.handoff').length, 0);
    assert.ok(records.some((entry) => entry.event === 'operation.failed' && entry.operation === 'proof.handoff'));
    assert.doesNotMatch(JSON.stringify({ records, response: failed.body }), /private-query|customer@example/);
  });

  it('admits correlation preflights only for the already configured origins', async () => {
    const response = await fetch(`${apiUrl}/invoices/any/proof-handoff`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example.invalid', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-request-id,x-correlation-id' },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.invalid');
    const allowed = response.headers.get('access-control-allow-headers')!.toLowerCase().split(',').map((value) => value.trim());
    assert.ok(allowed.includes('x-request-id'));
    assert.ok(allowed.includes('x-correlation-id'));
    const denied = await fetch(`${apiUrl}/invoices/any/proof-handoff`, {
      method: 'OPTIONS',
      headers: { origin: 'https://other.example.invalid', 'access-control-request-method': 'POST' },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });

  it('returns its fallback and keeps serving when the handoff and completion log sink throws', async () => {
    const invoice = await createPaidInvoice();
    setLogSink(() => { throw new Error('sink unavailable'); });
    assert.equal((await request(`/invoices/${invoice.id}/proof-handoff`, PRINT_HANDOFF)).status, 503);
    const response = await fetch(`${apiUrl}/invoices/${invoice.id}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).data.status, 'PAID');
  });

  it('bounds observation traffic without changing the paid invoice', async () => {
    const invoice = await createPaidInvoice();
    const before = JSON.stringify(await storage.getInvoiceById(invoice.id));
    for (let count = 0; count < 30; count += 1) {
      assert.equal((await request(`/invoices/${invoice.id}/proof-handoff`, PRINT_HANDOFF)).status, 202);
    }
    const limited = await request(`/invoices/${invoice.id}/proof-handoff`, PRINT_HANDOFF);
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.has('retry-after'));
    assert.equal(records.filter((entry) => entry.event === 'proof.handoff').length, 30);
    assert.equal(JSON.stringify(await storage.getInvoiceById(invoice.id)), before);
  });
});
