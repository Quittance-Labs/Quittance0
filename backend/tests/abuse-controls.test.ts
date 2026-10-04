import { after, before, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { Application } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { sellerAuthEnvironment, sellerAuthHeaders } from './fixtures/seller-auth';
import { createInvoiceRouter } from '../src/routes/invoice.routes';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { MemoryStorage } from '../src/storage/memory-storage';
import { bodyLimitErrorHandler } from '../src/middleware/body-limit';
import { getEdgeControlConfig, resolveEdgeControlConfig } from '../src/middleware/edge-config';
import {
  createRateLimiter,
  getClientIp,
  MemoryRateLimiterStore,
  resetRateLimiters,
} from '../src/middleware/rate-limit';

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
}

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  customHeaders: Record<string, string> = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let payload: Buffer | undefined;
    const headers: Record<string, string | number> = { ...customHeaders };

    if (body !== undefined) {
      if (typeof body === 'string') {
        payload = Buffer.from(body);
        if (!headers['content-type']) {
          headers['content-type'] = 'application/json';
        }
      } else {
        payload = Buffer.from(JSON.stringify(body));
        headers['content-type'] = 'application/json';
      }
      headers['content-length'] = payload.length;
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

describe('Abuse Controls Suite', () => {
  let server: http.Server;
  let port: number;
  let rawStorage: MemoryStorage;
  let invoiceStorage: MemoryInvoiceStorage;

  const sellerKeypair = Keypair.random();
  const sellerPublicKey = sellerKeypair.publicKey();
  const otherKeypair = Keypair.random();
  const otherPublicKey = otherKeypair.publicKey();

  function authenticatedRequest(
    targetPort: number, method: string, path: string, body?: unknown,
    headers: Record<string, string> = {}
  ) {
    return request(targetPort, method, path, body, { ...sellerAuthHeaders(sellerPublicKey), ...headers });
  }

  before(async () => {
    Object.assign(process.env, sellerAuthEnvironment);
    rawStorage = new MemoryStorage();
    const service = new InvoiceMemoryService(rawStorage);
    invoiceStorage = new MemoryInvoiceStorage(service);

    const app: Application = express();
    const maxBodyBytes = getEdgeControlConfig().maxBodyBytes;
    app.use(express.json({ limit: maxBodyBytes }));
    app.use(express.urlencoded({ extended: true, limit: maxBodyBytes }));

    const router = createInvoiceRouter({
      storage: invoiceStorage,
      enableRateLimiting: true,
      enableConcurrencyLock: true,
      enableCeilingCheck: true,
      requireCancelSignature: true,
    });

    app.use('/api', router);

    app.use(bodyLimitErrorHandler);
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.status(500).json({ success: false, error: err.message || 'Internal server error' });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    rawStorage.clear();
    resetRateLimiters();
  });

  describe('Scenario 1 & 2: Cancellation Ownership Proof', () => {
    it('refuses cancellation with an empty body and keeps invoice PENDING', async () => {
      const created = await rawStorage.createInvoice({
        id: 'inv-test-cancel-1',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'TESTMEMO1',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const res = await request(port, 'POST', `/api/invoices/${created.id}/cancel`, {});
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'AUTH_SESSION_REQUIRED');

      const check = await invoiceStorage.getInvoiceById(created.id);
      assert.equal(check?.status, 'PENDING');
    });

    it('refuses cancellation with a different seller public key', async () => {
      const created = await rawStorage.createInvoice({
        id: 'inv-test-cancel-2',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'TESTMEMO2',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const res = await authenticatedRequest(port, 'POST', `/api/invoices/${created.id}/cancel`, {
        sellerPublicKey: otherPublicKey,
      });

      // The authenticated seller cannot assert a different body identity.
      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);

      const check = await invoiceStorage.getInvoiceById(created.id);
      assert.equal(check?.status, 'PENDING');
    });

    it('refuses a public key or retired cancel blob without a seller session', async () => {
      const created = await rawStorage.createInvoice({
        id: 'inv-test-cancel-3',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'TESTMEMO3',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const signature = sellerKeypair.sign(Buffer.from(`cancel:${created.id}`)).toString('base64');
      for (const body of [{ sellerPublicKey }, { sellerPublicKey, signature }]) {
        const res = await request(port, 'POST', `/api/invoices/${created.id}/cancel`, body);
        assert.equal(res.status, 401);
        assert.equal(res.body.success, false);
        assert.equal(res.body.code, 'AUTH_SESSION_REQUIRED');
      }

      const check = await invoiceStorage.getInvoiceById(created.id);
      assert.equal(check?.status, 'PENDING');
    });

    it('refuses cancellation with an invalid session signature', async () => {
      const created = await rawStorage.createInvoice({
        id: 'inv-test-cancel-4',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'TESTMEMO4',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const pieces = sellerAuthHeaders(sellerPublicKey).authorization.split('.');
      pieces[2] = (pieces[2][0] === 'A' ? 'B' : 'A') + pieces[2].slice(1);
      const res = await request(port, 'POST', `/api/invoices/${created.id}/cancel`, {
        sellerPublicKey,
      }, { authorization: pieces.join('.') });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'AUTH_TOKEN_INVALID');

      const check = await invoiceStorage.getInvoiceById(created.id);
      assert.equal(check?.status, 'PENDING');
    });

    it('successfully cancels invoice with a verified seller session', async () => {
      const created = await rawStorage.createInvoice({
        id: 'inv-test-cancel-5',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'TESTMEMO5',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const res = await authenticatedRequest(port, 'POST', `/api/invoices/${created.id}/cancel`, {
        sellerPublicKey,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.status, 'CANCELLED');

      const check = await invoiceStorage.getInvoiceById(created.id);
      assert.equal(check?.status, 'CANCELLED');
    });
  });

  describe('Scenario 4: Creation Rate Limit and Storage Ceiling', () => {
    it('rate limits invoice creation beyond 5 requests per minute per IP', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await authenticatedRequest(port, 'POST', '/api/invoices', {
          sellerPublicKey,
          amount: 10,
          assetCode: 'XLM',
        });
        assert.equal(res.status, 201, `Request ${i + 1} should succeed`);
      }

      const excessive = await authenticatedRequest(port, 'POST', '/api/invoices', {
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
      });

      assert.equal(excessive.status, 429);
      assert.equal(excessive.body.success, false);
      assert.equal(excessive.body.code, 'RATE_LIMIT_EXCEEDED');
      assert.ok(excessive.headers['retry-after']);
    });

    it('keeps one create budget when an untrusted client rotates forwarding headers', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await authenticatedRequest(port, 'POST', '/api/invoices', {
          sellerPublicKey,
          amount: 10,
          assetCode: 'XLM',
        }, {
          'x-forwarded-for': `198.51.100.${i + 1}`,
          'idempotency-key': `untrusted-proxy-create-${i}`,
        });
        assert.equal(res.status, 201, `Request ${i + 1} should succeed`);
      }

      const excessive = await authenticatedRequest(port, 'POST', '/api/invoices', {
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
      }, {
        'x-forwarded-for': '203.0.113.100, 198.51.100.100',
        'idempotency-key': 'untrusted-proxy-create-over-budget',
      });

      assert.equal(excessive.status, 429);
      assert.equal(excessive.body.code, 'RATE_LIMIT_EXCEEDED');
      assert.ok(excessive.headers['retry-after']);
    });

    it('rejects creation with 503 and Retry-After when invoice ceiling is reached', async () => {
      const smallCeilingApp = express();
      smallCeilingApp.use(express.json());
      const ceilingStorage = new MemoryStorage();
      const ceilingService = new InvoiceMemoryService(ceilingStorage);
      const ceilingInvoiceStorage = new MemoryInvoiceStorage(ceilingService);

      const ceilingRouter = createInvoiceRouter({
        storage: ceilingInvoiceStorage,
        enableRateLimiting: false,
        enableCeilingCheck: true,
        invoiceCeiling: 2,
      });
      smallCeilingApp.use('/api', ceilingRouter);

      const ceilingServer = http.createServer(smallCeilingApp);
      await new Promise<void>((resolve) => ceilingServer.listen(0, '127.0.0.1', () => resolve()));
      const ceilingPort = (ceilingServer.address() as AddressInfo).port;

      try {
        const res1 = await authenticatedRequest(ceilingPort, 'POST', '/api/invoices', {
          sellerPublicKey,
          amount: 1,
        });
        assert.equal(res1.status, 201);

        const res2 = await authenticatedRequest(ceilingPort, 'POST', '/api/invoices', {
          sellerPublicKey,
          amount: 2,
        });
        assert.equal(res2.status, 201);

        const fullRes = await authenticatedRequest(ceilingPort, 'POST', '/api/invoices', {
          sellerPublicKey,
          amount: 3,
        });

        assert.equal(fullRes.status, 503);
        assert.equal(fullRes.body.success, false);
        assert.equal(fullRes.body.code, 'INVOICE_STORE_FULL');
        assert.equal(fullRes.headers['retry-after'], '300');
        assert.equal(ceilingStorage.size(), 2);
      } finally {
        ceilingServer.close();
      }
    });
  });

  describe('Scenario 6: Payload Body Size Limit', () => {
    it('rejects JSON payloads exceeding 16 kB with 413', async () => {
      const oversizedData = 'x'.repeat(17 * 1024);
      const payload = JSON.stringify({
        sellerPublicKey,
        amount: 10,
        description: oversizedData,
      });

      const res = await request(port, 'POST', '/api/invoices', payload);
      assert.equal(res.status, 413);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'PAYLOAD_TOO_LARGE');
      assert.match(res.body.error, /16 kB limit/i);
    });
  });

  describe('Scenario 5: Listing Rate Limiting', () => {
    it('rate limits GET /invoices beyond 60 requests per minute', async () => {
      for (let i = 0; i < 60; i++) {
        const res = await authenticatedRequest(port, 'GET', `/api/invoices?sellerPublicKey=${sellerPublicKey}`);
        assert.equal(res.status, 200);
      }

      const excessive = await authenticatedRequest(port, 'GET', `/api/invoices?sellerPublicKey=${sellerPublicKey}`);
      assert.equal(excessive.status, 429);
      assert.equal(excessive.body.success, false);
      assert.equal(excessive.body.code, 'RATE_LIMIT_EXCEEDED');
      assert.ok(excessive.headers['retry-after']);
    });
  });

  describe('Scenario 3: Verification Rate Limiting & Concurrency Lock', () => {
    it('rate limits verification beyond 10 requests per minute for a single invoice', async () => {
      const invoice = await rawStorage.createInvoice({
        id: 'inv-verify-target-limit',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'VERIFYMEMO1',
        expiresAt: new Date(Date.now() + 86400000),
      });

      for (let i = 0; i < 10; i++) {
        const res = await request(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
          txHash: '0'.repeat(64),
        });
        assert.notEqual(res.status, 429);
      }

      const excessive = await request(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
        txHash: '0'.repeat(64),
      });
      assert.equal(excessive.status, 429);
      assert.equal(excessive.body.success, false);
      assert.equal(excessive.body.code, 'RATE_LIMIT_EXCEEDED');
      assert.match(excessive.body.error, /Max 10 verification requests per minute/i);
    });

    it('rejects concurrent verification requests for the same invoice with 429 VERIFY_IN_PROGRESS', async () => {
      const invoice = await rawStorage.createInvoice({
        id: 'inv-verify-concurrent',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'VERIFYMEMO2',
        expiresAt: new Date(Date.now() + 86400000),
      });

      let unblockStellar: () => void = () => {};
      const slowStellar = {
        getTransaction: () =>
          new Promise((resolve) => {
            unblockStellar = () => resolve({ memo: invoice.memo, operations: [] });
          }),
      };

      const customApp = express();
      customApp.use(express.json());
      const customRouter = createInvoiceRouter({
        storage: invoiceStorage,
        stellar: slowStellar as any,
        enableConcurrencyLock: true,
        enableRateLimiting: false,
      });
      customApp.use('/api', customRouter);

      const lockServer = http.createServer(customApp);
      await new Promise<void>((resolve) => lockServer.listen(0, '127.0.0.1', () => resolve()));
      const lockPort = (lockServer.address() as AddressInfo).port;

      try {
        const firstPromise = request(lockPort, 'POST', `/api/invoices/${invoice.id}/verify`, {
          txHash: '1'.repeat(64),
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        const secondPromise = request(lockPort, 'POST', `/api/invoices/${invoice.id}/verify`, {
          txHash: '2'.repeat(64),
        });

        const secondRes = await secondPromise;
        assert.equal(secondRes.status, 429);
        assert.equal(secondRes.body.success, false);
        assert.equal(secondRes.body.code, 'VERIFY_IN_PROGRESS');
        assert.equal(secondRes.body.retryAfter, 5);

        unblockStellar();
        await firstPromise;
      } finally {
        lockServer.close();
      }
    });
  });

  describe('Scenario 7: Production Environment Dev-Route Guard', () => {
    it('refuses simulate-payment when NODE_ENV is production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const prodApp = express();
      prodApp.use(express.json());
      const prodRouter = createInvoiceRouter({
        storage: invoiceStorage,
      });
      prodApp.use('/api', prodRouter);

      const prodServer = http.createServer(prodApp);
      await new Promise<void>((resolve) => prodServer.listen(0, '127.0.0.1', () => resolve()));
      const prodPort = (prodServer.address() as AddressInfo).port;

      try {
        const res = await request(
          prodPort,
          'POST',
          '/api/invoices/00000000-0000-0000-0000-000000000000/simulate-payment'
        );
        assert.equal(res.status, 404);
        assert.equal(res.body.success, false);
        assert.match(res.body.error, /endpoint not found/i);
      } finally {
        process.env.NODE_ENV = originalEnv;
        prodServer.close();
      }
    });
  });

  describe('Issue #450: middleware order trips and legitimate verify', () => {
    it('create ceiling trips before rate limits with stable 503 INVOICE_STORE_FULL', async () => {
      const smallCeilingApp = express();
      smallCeilingApp.use(express.json({ limit: '16kb' }));
      const ceilingStorage = new MemoryStorage();
      const ceilingService = new InvoiceMemoryService(ceilingStorage);
      const ceilingInvoiceStorage = new MemoryInvoiceStorage(ceilingService);

      const ceilingRouter = createInvoiceRouter({
        storage: ceilingInvoiceStorage,
        enableRateLimiting: true,
        enableCeilingCheck: true,
        invoiceCeiling: 1,
      });
      smallCeilingApp.use('/api', ceilingRouter);

      const ceilingServer = http.createServer(smallCeilingApp);
      await new Promise<void>((resolve) => ceilingServer.listen(0, '127.0.0.1', () => resolve()));
      const ceilingPort = (ceilingServer.address() as AddressInfo).port;

      try {
        const first = await authenticatedRequest(ceilingPort, 'POST', '/api/invoices', {
          sellerPublicKey,
          amount: 1,
        });
        assert.equal(first.status, 201);

        // Second create must be the ceiling (503), not a rate-limit 429 — order
        // is ceiling → rate limits, and we are still inside the create budget.
        const full = await authenticatedRequest(ceilingPort, 'POST', '/api/invoices', {
          sellerPublicKey,
          amount: 2,
        });
        assert.equal(full.status, 503);
        assert.equal(full.body.success, false);
        assert.equal(full.body.code, 'INVOICE_STORE_FULL');
        assert.ok(full.body.retryAfter);
        assert.equal(full.headers['retry-after'], String(full.body.retryAfter));
        assert.equal(ceilingStorage.size(), 1);
      } finally {
        ceilingServer.close();
      }
    });

    it('verify invoice rate limit returns stable 429 RATE_LIMIT_EXCEEDED body', async () => {
      const invoice = await rawStorage.createInvoice({
        id: 'inv-450-verify-flood',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'EDGE450V',
        expiresAt: new Date(Date.now() + 86400000),
      });

      for (let i = 0; i < 10; i++) {
        const res = await request(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
          txHash: 'a'.repeat(64),
        });
        assert.notEqual(res.status, 429, `request ${i + 1} should be under the limit`);
      }

      const tripped = await request(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
        txHash: 'a'.repeat(64),
      });
      assert.equal(tripped.status, 429);
      assert.equal(tripped.body.success, false);
      assert.equal(tripped.body.code, 'RATE_LIMIT_EXCEEDED');
      assert.ok(typeof tripped.body.error === 'string');
      assert.ok(tripped.body.retryAfter);
      assert.ok(tripped.headers['retry-after']);
    });

    it('oversized body returns stable 413 PAYLOAD_TOO_LARGE before any write', async () => {
      const before = rawStorage.size();
      const oversizedData = 'x'.repeat(17 * 1024);
      const payload = JSON.stringify({
        sellerPublicKey,
        amount: 10,
        description: oversizedData,
      });

      const res = await request(port, 'POST', '/api/invoices', payload);
      assert.equal(res.status, 413);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'PAYLOAD_TOO_LARGE');
      assert.match(res.body.error, /kB limit/i);
      assert.equal(rawStorage.size(), before);
    });

    it('a legitimate single verify still succeeds under the edge stack', async () => {
      const invoice = await rawStorage.createInvoice({
        id: 'inv-450-legit-verify',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'LEGIT450',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const payerPublicKey = Keypair.random().publicKey();
      const txHash = 'b'.repeat(64);

      const customApp = express();
      customApp.use(express.json({ limit: getEdgeControlConfig().maxBodyBytes }));
      customApp.use(bodyLimitErrorHandler);

      const stellar = {
        getTransaction: async () => ({
          transaction: {
            memo: invoice.memo,
            memo_type: 'text',
            created_at: new Date().toISOString(),
          },
          operations: [
            {
              type: 'payment',
              from: payerPublicKey,
              to: sellerPublicKey,
              amount: '10.0000000',
              asset_type: 'native',
            },
          ],
        }),
      };

      const router = createInvoiceRouter({
        storage: invoiceStorage,
        stellar: stellar as any,
        enableRateLimiting: true,
        enableConcurrencyLock: true,
        enableVerifyCache: true,
      });
      customApp.use('/api', router);

      const customServer = http.createServer(customApp);
      await new Promise<void>((resolve) => customServer.listen(0, '127.0.0.1', () => resolve()));
      const customPort = (customServer.address() as AddressInfo).port;

      try {
        const res = await request(customPort, 'POST', `/api/invoices/${invoice.id}/verify`, {
          txHash,
        });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.status, 'PAID');
        assert.notEqual(res.body.code, 'RATE_LIMIT_EXCEEDED');
        assert.notEqual(res.body.cached, true);

        const check = await invoiceStorage.getInvoiceById(invoice.id);
        assert.equal(check?.status, 'PAID');
      } finally {
        customServer.close();
      }
    });

    it('verify concurrency lock returns stable 429 VERIFY_IN_PROGRESS ahead of rate limits', async () => {
      const invoice = await rawStorage.createInvoice({
        id: 'inv-450-verify-lock',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'LOCK450',
        expiresAt: new Date(Date.now() + 86400000),
      });

      let unblock: () => void = () => {};
      const slowStellar = {
        getTransaction: () =>
          new Promise((resolve) => {
            unblock = () =>
              resolve({
                transaction: {
                  memo: invoice.memo,
                  memo_type: 'text',
                  created_at: new Date().toISOString(),
                },
                operations: [],
              });
          }),
      };

      const lockApp = express();
      lockApp.use(express.json());
      lockApp.use(
        '/api',
        createInvoiceRouter({
          storage: invoiceStorage,
          stellar: slowStellar as any,
          enableConcurrencyLock: true,
          enableRateLimiting: true,
        })
      );

      const lockServer = http.createServer(lockApp);
      await new Promise<void>((resolve) => lockServer.listen(0, '127.0.0.1', () => resolve()));
      const lockPort = (lockServer.address() as AddressInfo).port;

      try {
        const firstPromise = request(lockPort, 'POST', `/api/invoices/${invoice.id}/verify`, {
          txHash: 'c'.repeat(64),
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const second = await request(lockPort, 'POST', `/api/invoices/${invoice.id}/verify`, {
          txHash: 'd'.repeat(64),
        });

        assert.equal(second.status, 429);
        assert.equal(second.body.code, 'VERIFY_IN_PROGRESS');
        assert.equal(second.body.success, false);
        assert.ok(second.body.retryAfter);

        unblock();
        await firstPromise;
      } finally {
        lockServer.close();
      }
    });
  });

});

describe('Configured request body limits', () => {
  const scenarios = [
    { name: 'default', env: {}, bytes: 16384, label: '16 kB' },
    { name: 'smaller byte override', env: { MAX_BODY_BYTES: '1024' }, bytes: 1024, label: '1 kB' },
    { name: 'larger byte override', env: { MAX_BODY_BYTES: '32768' }, bytes: 32768, label: '32 kB' },
    { name: 'exact non-KiB cap', env: { MAX_BODY_BYTES: '1234' }, bytes: 1234, label: '1234 byte' },
    { name: 'explicit string precedence', env: { MAX_BODY_BYTES: '32768', MAX_BODY_STRING: '1kb' }, bytes: 1024, label: '1 kB' },
    { name: 'invalid string falls back to bytes', env: { MAX_BODY_BYTES: '1234', MAX_BODY_STRING: 'invalid' }, bytes: 1234, label: '1234 byte' },
  ];

  function payload(type: string, bytes: number): string {
    const prefix = type === 'application/json' ? '{"memo":"' : 'memo=';
    const suffix = type === 'application/json' ? '"}' : '';
    return prefix + 'x'.repeat(bytes - prefix.length - suffix.length) + suffix;
  }

  for (const scenario of scenarios) {
    it(`enforces ${scenario.name} for actual JSON and form requests before the handler`, async () => {
      const config = resolveEdgeControlConfig(scenario.env);
      const app = express();
      let accepted = 0;
      app.use(express.json({ limit: config.maxBodyBytes }));
      app.use(express.urlencoded({ extended: true, limit: config.maxBodyBytes }));
      app.post('/body-boundary', (_req, res) => {
        accepted += 1;
        res.sendStatus(204);
      });
      app.use(bodyLimitErrorHandler);
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as AddressInfo).port;
      try {
        for (const type of ['application/json', 'application/x-www-form-urlencoded']) {
          const exact = await request(port, 'POST', '/body-boundary', payload(type, scenario.bytes), { 'content-type': type });
          assert.equal(exact.status, 204, `${type}: exact cap is accepted`);
          const before = accepted;
          const over = await request(port, 'POST', '/body-boundary', payload(type, scenario.bytes + 1), { 'content-type': type });
          assert.equal(over.status, 413, `${type}: one extra byte is rejected`);
          assert.deepEqual(over.body, {
            success: false,
            code: 'PAYLOAD_TOO_LARGE',
            error: `Payload too large: request body exceeds ${scenario.label} limit`,
          });
          assert.equal(accepted, before, 'oversized requests must not reach the handler');
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  }

  it('reports the parser-captured cap even when environment changes after construction', async () => {
    const previousBytes = process.env.MAX_BODY_BYTES;
    const previousString = process.env.MAX_BODY_STRING;
    process.env.MAX_BODY_BYTES = '1234';
    delete process.env.MAX_BODY_STRING;
    const config = getEdgeControlConfig();
    const app = express();
    app.use(express.json({ limit: config.maxBodyBytes }));
    app.post('/body-boundary', (_req, res) => res.sendStatus(204));
    app.use(bodyLimitErrorHandler);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      process.env.MAX_BODY_BYTES = '32768';
      process.env.MAX_BODY_STRING = '32kb';
      const response = await request((server.address() as AddressInfo).port, 'POST', '/body-boundary', payload('application/json', 1235));
      assert.equal(response.status, 413);
      assert.equal(response.body.error, 'Payload too large: request body exceeds 1234 byte limit');
    } finally {
      if (previousBytes === undefined) delete process.env.MAX_BODY_BYTES;
      else process.env.MAX_BODY_BYTES = previousBytes;
      if (previousString === undefined) delete process.env.MAX_BODY_STRING;
      else process.env.MAX_BODY_STRING = previousString;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('keeps external 413 errors generic when no parser limit is available', async () => {
    const app = express();
    app.post('/external-limit', (_req, _res, next) => next({ status: 413 }));
    app.use(bodyLimitErrorHandler);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await request((server.address() as AddressInfo).port, 'POST', '/external-limit');
      assert.equal(response.status, 413);
      assert.deepEqual(response.body, {
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        error: 'Payload too large: request body exceeds configured limit',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('Rate-limit client identity behind a trusted proxy', () => {
  it('uses the first untrusted hop and keeps distinct clients isolated', async () => {
    const store = new MemoryRateLimiterStore();
    const app = express();
    app.set('trust proxy', 'loopback');
    app.get('/limited', createRateLimiter({ windowMs: 60_000, max: 2 }, store), (req, res) => {
      res.json({ ip: getClientIp(req) });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const asClient = (client: string, prefix: string) => request(
      port, 'GET', '/limited', undefined,
      { 'x-forwarded-for': `${prefix}, ${client}` }
    );

    try {
      const first = await asClient('203.0.113.10', '198.51.100.1');
      const second = await asClient('203.0.113.10', '198.51.100.2');
      const excessive = await asClient('203.0.113.10', '198.51.100.3');
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(excessive.status, 429);
      assert.equal(excessive.body.code, 'RATE_LIMIT_EXCEEDED');
      assert.ok(excessive.headers['retry-after']);
      assert.equal(first.body.ip, '203.0.113.10');

      const other = await asClient('203.0.113.20', '198.51.100.1');
      assert.equal(other.status, 200);
      assert.equal(other.body.ip, '203.0.113.20');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.destroy();
    }
  });
});
