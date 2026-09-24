import { after, before, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { Application } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { createInvoiceRouter } from '../src/routes/invoice.routes';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { MemoryStorage } from '../src/storage/memory-storage';
import { resetRateLimiters } from '../src/middleware/rate-limit';

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

  before(async () => {
    rawStorage = new MemoryStorage();
    const service = new InvoiceMemoryService(rawStorage);
    invoiceStorage = new MemoryInvoiceStorage(service);

    const app: Application = express();
    app.use(express.json({ limit: '16kb' }));
    app.use(express.urlencoded({ extended: true, limit: '16kb' }));

    const router = createInvoiceRouter({
      storage: invoiceStorage,
      enableRateLimiting: true,
      enableConcurrencyLock: true,
      enableCeilingCheck: true,
      requireCancelSignature: true,
    });

    app.use('/api', router);

    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
        return res.status(413).json({
          success: false,
          code: 'PAYLOAD_TOO_LARGE',
          error: 'Payload too large: request body exceeds 16 kB limit',
        });
      }
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
      assert.equal(res.body.code, 'UNAUTHORIZED');

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

      const fakeSig = otherKeypair.sign(Buffer.from(`cancel:${created.id}`)).toString('base64');
      const res = await request(port, 'POST', `/api/invoices/${created.id}/cancel`, {
        sellerPublicKey: otherPublicKey,
        signature: fakeSig,
      });

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);

      const check = await invoiceStorage.getInvoiceById(created.id);
      assert.equal(check?.status, 'PENDING');
    });

    it('refuses cancellation with correct seller public key but missing signature', async () => {
      const created = await rawStorage.createInvoice({
        id: 'inv-test-cancel-3',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'TESTMEMO3',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const res = await request(port, 'POST', `/api/invoices/${created.id}/cancel`, {
        sellerPublicKey,
      });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'UNAUTHORIZED');

      const check = await invoiceStorage.getInvoiceById(created.id);
      assert.equal(check?.status, 'PENDING');
    });

    it('refuses cancellation with invalid cryptographic signature', async () => {
      const created = await rawStorage.createInvoice({
        id: 'inv-test-cancel-4',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'TESTMEMO4',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const corruptSig = Buffer.alloc(64, 1).toString('base64');
      const res = await request(port, 'POST', `/api/invoices/${created.id}/cancel`, {
        sellerPublicKey,
        signature: corruptSig,
      });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'INVALID_SIGNATURE');

      const check = await invoiceStorage.getInvoiceById(created.id);
      assert.equal(check?.status, 'PENDING');
    });

    it('successfully cancels invoice with verified ed25519 seller signature', async () => {
      const created = await rawStorage.createInvoice({
        id: 'inv-test-cancel-5',
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
        memo: 'TESTMEMO5',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const validSig = sellerKeypair
        .sign(Buffer.from(`cancel:${created.id}`))
        .toString('base64');
      const res = await request(port, 'POST', `/api/invoices/${created.id}/cancel`, {
        sellerPublicKey,
        signature: validSig,
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
        const res = await request(port, 'POST', '/api/invoices', {
          sellerPublicKey,
          amount: 10,
          assetCode: 'XLM',
        });
        assert.equal(res.status, 201, `Request ${i + 1} should succeed`);
      }

      const excessive = await request(port, 'POST', '/api/invoices', {
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
      });

      assert.equal(excessive.status, 429);
      assert.equal(excessive.body.success, false);
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
        const res1 = await request(ceilingPort, 'POST', '/api/invoices', {
          sellerPublicKey,
          amount: 1,
        });
        assert.equal(res1.status, 201);

        const res2 = await request(ceilingPort, 'POST', '/api/invoices', {
          sellerPublicKey,
          amount: 2,
        });
        assert.equal(res2.status, 201);

        const fullRes = await request(ceilingPort, 'POST', '/api/invoices', {
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
        const res = await request(port, 'GET', `/api/invoices?sellerPublicKey=${sellerPublicKey}`);
        assert.equal(res.status, 200);
      }

      const excessive = await request(port, 'GET', `/api/invoices?sellerPublicKey=${sellerPublicKey}`);
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
});
