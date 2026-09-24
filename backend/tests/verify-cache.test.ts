import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { Application } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { createInvoiceRouter } from '../src/routes/invoice.routes';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { MemoryStorage } from '../src/storage/memory-storage';
import {
  VerificationCache,
  createVerifyCacheMiddleware,
  verificationCacheTtl,
} from '../src/middleware/verify-cache';
import { resetRateLimiters } from '../src/middleware/rate-limit';

const TX_HASH_A = 'a'.repeat(64);
const TX_HASH_B = 'b'.repeat(64);

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
}

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let payload: Buffer | undefined;
    const headers: Record<string, string | number> = {};
    if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
      headers['content-type'] = 'application/json';
      headers['content-length'] = payload.length;
    }
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let parsed: any;
          try { parsed = JSON.parse(raw); } catch { parsed = raw; }
          resolve({ status: res.statusCode || 0, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function fakeRes() {
  return {
    statusCode: 0,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
}

function fakeReq(overrides: Record<string, unknown> = {}) {
  return {
    path: `/invoices/inv-1/verify`,
    params: { id: 'inv-1' },
    body: { txHash: TX_HASH_A },
    ...overrides,
  } as any;
}

describe('verify cache TTL policy', () => {
  it('keeps verified results for the invoice expiry window', () => {
    assert.equal(verificationCacheTtl({ success: true }), 259200);
  });

  it('keeps semantic rejections for the full window', () => {
    assert.equal(verificationCacheTtl({ success: false, code: 'MEMO_MISMATCH' }), 259200);
    assert.equal(verificationCacheTtl({ success: false, code: 'TX_HASH_ALREADY_USED' }), 259200);
  });

  it('bounds TRANSACTION_NOT_FOUND to the short negative TTL', () => {
    assert.equal(verificationCacheTtl({ success: false, code: 'TRANSACTION_NOT_FOUND' }), 60);
  });

  it('never caches transient service states', () => {
    assert.equal(verificationCacheTtl({ success: false, code: 'VERIFY_UNAVAILABLE' }), null);
    assert.equal(verificationCacheTtl({ success: false, code: 'VERIFY_RATE_LIMIT_EXCEEDED' }), null);
    assert.equal(
      verificationCacheTtl({ success: false, code: 'TRANSACTION_CLOSE_TIME_UNAVAILABLE' }),
      null
    );
  });
});

describe('VerificationCache', () => {
  it('expires negative not-found entries while positive entries survive', async () => {
    let now = 1_000_000;
    const cache = new VerificationCache(() => now);

    await cache.set('inv-1', TX_HASH_A, 404, { success: false, code: 'TRANSACTION_NOT_FOUND' });
    await cache.set('inv-1', TX_HASH_B, 400, { success: false, code: 'MEMO_MISMATCH' });
    await cache.set('inv-2', TX_HASH_A, 200, { success: true });

    now += 61_000;

    assert.equal(await cache.get('inv-1', TX_HASH_A), null);
    assert.notEqual(await cache.get('inv-1', TX_HASH_B), null);
    assert.notEqual(await cache.get('inv-2', TX_HASH_A), null);
  });

  it('never caches transient service states', async () => {
    const cache = new VerificationCache();
    await cache.set('inv-1', TX_HASH_A, 503, { success: false, code: 'VERIFY_UNAVAILABLE' });
    assert.equal(await cache.get('inv-1', TX_HASH_A), null);
  });

  it('drops a previously cached VERIFY_UNAVAILABLE instead of replaying it', async () => {
    const cache = new VerificationCache();
    const key = 'verify:inv-1:' + TX_HASH_A;
    (cache as any).memoryCache.set(key, {
      invoiceId: 'inv-1',
      txHash: TX_HASH_A,
      httpStatus: 503,
      body: { success: false, code: 'VERIFY_UNAVAILABLE' },
      expiresAt: Date.now() + 60_000,
    });

    assert.equal(await cache.get('inv-1', TX_HASH_A), null);
    assert.equal(await cache.get('inv-1', TX_HASH_A), null);
  });

  it('scopes entries to the invoice and tx hash', async () => {
    const cache = new VerificationCache();
    await cache.set('inv-1', TX_HASH_A, 200, { success: true });

    assert.equal(await cache.get('inv-2', TX_HASH_A), null);
    assert.equal(await cache.get('inv-1', TX_HASH_B), null);
    assert.notEqual(await cache.get('inv-1', TX_HASH_A), null);
  });
});

describe('verify cache middleware', () => {
  it('replays the recorded response on a hit', async () => {
    const cache = new VerificationCache();
    await cache.set('inv-1', TX_HASH_A, 200, { success: true, data: { status: 'PAID' } });

    const mw = createVerifyCacheMiddleware(cache);
    const res = fakeRes();
    let nextCalled = false;
    await new Promise<void>((resolve) => {
      mw(fakeReq(), res as any, () => { nextCalled = true; resolve(); });
      setImmediate(resolve);
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, 'PAID');
    assert.equal(res.body.cached, true);
  });

  it('falls through to the handler on a miss', async () => {
    const cache = new VerificationCache();
    const mw = createVerifyCacheMiddleware(cache);
    let nextCalled = false;
    await new Promise<void>((resolve) => {
      mw(fakeReq(), fakeRes() as any, () => { nextCalled = true; resolve(); });
    });
    assert.equal(nextCalled, true);
  });

  it('ignores non-verify routes and missing params', async () => {
    const cache = new VerificationCache();
    await cache.set('inv-1', TX_HASH_A, 200, { success: true });
    const mw = createVerifyCacheMiddleware(cache);

    for (const req of [
      fakeReq({ path: '/invoices/inv-1' }),
      fakeReq({ params: {} }),
      fakeReq({ body: {} }),
    ]) {
      let nextCalled = false;
      await new Promise<void>((resolve) => {
        mw(req, fakeRes() as any, () => { nextCalled = true; resolve(); });
      });
      assert.equal(nextCalled, true);
    }
  });
});

describe('verify cache end to end', () => {
  const sellerKeypair = Keypair.random();
  const sellerPublicKey = sellerKeypair.publicKey();
  const payerPublicKey = Keypair.random().publicKey();

  let server: http.Server;
  let port: number;
  let rawStorage: MemoryStorage;
  let clock: number;
  let horizonCalls: string[];

  function validTx(memo: string, destination: string) {
    return {
      transaction: {
        memo,
        memo_type: 'text',
        created_at: new Date(clock).toISOString(),
      },
      operations: [
        {
          type: 'payment',
          from: payerPublicKey,
          to: destination,
          amount: '10.0000000',
          asset_type: 'native',
        },
      ],
    };
  }

  const stellarByHash: { getTransaction: (txHash: string) => Promise<any> } = {
    getTransaction: async (txHash: string) => {
      horizonCalls.push(txHash);
      const tx = validTxByHash[txHash];
      if (!tx) throw new Error('tx not found');
      return tx;
    },
  };
  const validTxByHash: Record<string, any> = {};

  before(async () => {
    rawStorage = new MemoryStorage();
    const service = new InvoiceMemoryService(rawStorage);
    const invoiceStorage = new MemoryInvoiceStorage(service);
    const cache = new VerificationCache(() => clock);

    const app: Application = express();
    app.use(express.json());
    app.use(
      '/api',
      createInvoiceRouter({
        storage: invoiceStorage,
        stellar: stellarByHash,
        verifyCache: cache,
        enableRateLimiting: false,
        enableConcurrencyLock: false,
      })
    );

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    rawStorage.clear();
    resetRateLimiters();
    horizonCalls = [];
    for (const key of Object.keys(validTxByHash)) delete validTxByHash[key];
    clock = Date.now();
  });

  async function createInvoice(id: string) {
    return rawStorage.createInvoice({
      id,
      sellerPublicKey,
      amount: 10,
      assetCode: 'XLM',
      memo: `MEMO-${id}`,
      expiresAt: new Date(clock + 86400000),
    });
  }

  it('replays a verified result without another Horizon call', async () => {
    const invoice = await createInvoice('inv-cache-paid');
    validTxByHash[TX_HASH_A] = validTx(invoice.memo, sellerPublicKey);

    const first = await request(port, 'POST', `/api/invoices/${invoice.id}/verify`, { txHash: TX_HASH_A });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.status, 'PAID');
    assert.equal(horizonCalls.length, 1);

    const second = await request(port, 'POST', `/api/invoices/${invoice.id}/verify`, { txHash: TX_HASH_A });
    assert.equal(second.status, 200);
    assert.equal(second.body.data.status, 'PAID');
    assert.equal(second.body.cached, true);
    assert.equal(horizonCalls.length, 1);
  });

  it('lets a not-found hash reach Horizon again after the short TTL', async () => {
    const invoice = await createInvoice('inv-cache-lag');

    const first = await request(port, 'POST', `/api/invoices/${invoice.id}/verify`, { txHash: TX_HASH_A });
    assert.equal(first.status, 404);
    assert.equal(first.body.code, 'TRANSACTION_NOT_FOUND');

    // Within the negative TTL the replay spares Horizon.
    const second = await request(port, 'POST', `/api/invoices/${invoice.id}/verify`, { txHash: TX_HASH_A });
    assert.equal(second.status, 404);
    assert.equal(second.body.cached, true);
    assert.equal(horizonCalls.length, 1);

    // Once Horizon indexes the tx the retry must reach PAID, not the cached reject.
    clock += 61_000;
    validTxByHash[TX_HASH_A] = validTx(invoice.memo, sellerPublicKey);
    const third = await request(port, 'POST', `/api/invoices/${invoice.id}/verify`, { txHash: TX_HASH_A });
    assert.equal(third.status, 200);
    assert.equal(third.body.data.status, 'PAID');
    assert.equal(horizonCalls.length, 2);
  });

  it('does not let a rejected hash block a different hash on the same invoice', async () => {
    const invoice = await createInvoice('inv-cache-hash');
    validTxByHash[TX_HASH_B] = validTx(invoice.memo, sellerPublicKey);

    const first = await request(port, 'POST', `/api/invoices/${invoice.id}/verify`, { txHash: TX_HASH_A });
    assert.equal(first.status, 404);

    const second = await request(port, 'POST', `/api/invoices/${invoice.id}/verify`, { txHash: TX_HASH_B });
    assert.equal(second.status, 200);
    assert.equal(second.body.data.status, 'PAID');
    assert.equal(horizonCalls.length, 2);
  });

  it('never applies a cached PAID to a different invoice', async () => {
    const invoiceA = await createInvoice('inv-cache-a');
    const invoiceB = await createInvoice('inv-cache-b');
    validTxByHash[TX_HASH_A] = validTx(invoiceA.memo, sellerPublicKey);

    const first = await request(port, 'POST', `/api/invoices/${invoiceA.id}/verify`, { txHash: TX_HASH_A });
    assert.equal(first.status, 200);

    // The (invoice, hash) key makes B a miss: the request reaches the handler
    // and fails on its own merits instead of replaying A's PAID.
    const second = await request(port, 'POST', `/api/invoices/${invoiceB.id}/verify`, { txHash: TX_HASH_A });
    assert.equal(second.status, 400);
    assert.equal(second.body.code, 'MEMO_MISMATCH');
    assert.equal(second.body.cached, undefined);

    const check = await rawStorage.getInvoiceById(invoiceB.id);
    assert.equal(check?.status, 'PENDING');
  });

  it('still 429s a repeated-hash flood without extra Horizon calls', async () => {
    const invoice = await createInvoice('inv-cache-flood');

    // A second router with rate limiting enabled, sharing the same cache:
    // repeats are cache hits, so the flood burns rate-limit budget, not Horizon.
    const floodApp = express();
    floodApp.use(express.json());
    floodApp.use(
      '/api',
      createInvoiceRouter({
        storage: new MemoryInvoiceStorage(new InvoiceMemoryService(rawStorage)),
        stellar: stellarByHash,
        verifyCache: new VerificationCache(() => clock),
        enableRateLimiting: true,
        enableConcurrencyLock: false,
      })
    );
    const floodServer = http.createServer(floodApp);
    await new Promise<void>((resolve) => floodServer.listen(0, '127.0.0.1', () => resolve()));
    const floodPort = (floodServer.address() as AddressInfo).port;

    try {
      let saw429 = false;
      for (let i = 0; i < 12; i++) {
        const res = await request(floodPort, 'POST', `/api/invoices/${invoice.id}/verify`, {
          txHash: TX_HASH_A,
        });
        if (res.status === 429) saw429 = true;
      }
      assert.equal(saw429, true);
      assert.equal(horizonCalls.length, 1);
    } finally {
      await new Promise<void>((resolve) => floodServer.close(() => resolve()));
    }
  });
});
