import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { MemoryStorage } from '../src/storage/memory-storage';

const ALICE = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const BOB = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const CAROL = 'GCAROL000000000000000000000000000000000000000000000';

function input(sellerPublicKey: string, overrides: Record<string, unknown> = {}) {
  return {
    sellerPublicKey,
    amount: 25,
    assetCode: 'XLM',
    memo: 'QTN-SCOPE',
    description: 'wallet scoping',
    ...overrides,
  } as any;
}

async function seed() {
  // A fresh MemoryStorage per case: the default one is a module singleton
  // shared by every test in the process, so counts would leak between them.
  const storage = new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage()));
  const alice = [
    await storage.createInvoice(input(ALICE)),
    await storage.createInvoice(input(ALICE, { amount: 40 })),
  ];
  const bob = [await storage.createInvoice(input(BOB, { amount: 10 }))];
  return { storage, alice, bob };
}

describe('wallet-scoped invoice reads', () => {
  it('returns only the requesting seller rows', async () => {
    const { storage, alice } = await seed();

    const rows = await storage.getInvoicesBySeller(ALICE);

    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.id).sort(),
      alice.map((row) => row.id).sort()
    );
    assert.ok(rows.every((row) => row.sellerPublicKey === ALICE));
  });

  it('shows a switched wallet none of the previous wallet rows', async () => {
    const { storage, alice, bob } = await seed();

    const firstWallet = await storage.getInvoicesBySeller(ALICE);
    const secondWallet = await storage.getInvoicesBySeller(BOB);

    assert.equal(firstWallet.length, 2);
    assert.equal(secondWallet.length, 1);
    assert.equal(secondWallet[0].id, bob[0].id);
    for (const row of alice) {
      assert.ok(!secondWallet.some((other) => other.id === row.id));
    }
  });

  it('counts stats per wallet instead of across wallets', async () => {
    const { storage } = await seed();

    const [aliceStats] = await storage.getInvoiceStats(ALICE);
    const [bobStats] = await storage.getInvoiceStats(BOB);

    assert.equal(aliceStats.total_invoices, 2);
    assert.equal(aliceStats.pending_invoices, 2);
    assert.equal(bobStats.total_invoices, 1);
    assert.equal(bobStats.pending_invoices, 1);
    assert.deepEqual(aliceStats.revenue_by_asset, {});
  });

  it('returns nothing at all for a wallet that has no invoices', async () => {
    const { storage } = await seed();

    assert.deepEqual(await storage.getInvoicesBySeller(CAROL), []);
    const [carolStats] = await storage.getInvoiceStats(CAROL);
    assert.equal(carolStats.total_invoices, 0);
    assert.equal(carolStats.pending_invoices, 0);
  });

  it('filters invoices by search query within seller scope', async () => {
    const storage = new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage()));
    const matching = await storage.createInvoice(
      input(ALICE, { memo: 'QTN-ALPHA', description: 'Alpha payment' })
    );
    await storage.createInvoice(
      input(ALICE, { memo: 'QTN-BETA', description: 'Beta payment' })
    );
    await storage.createInvoice(
      input(BOB, { memo: 'QTN-ALPHA', description: 'Bob Alpha payment' })
    );

    const results = await storage.getInvoicesBySeller(ALICE, undefined, 50, 0, 'ALPHA');

    assert.equal(results.length, 1);
    assert.equal(results[0].id, matching.id);
    assert.equal(results[0].sellerPublicKey, ALICE);
  });

  it('never leaks another seller invoices when searching', async () => {
    const storage = new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage()));
    await storage.createInvoice(
      input(BOB, { memo: 'QTN-SECRET', description: 'Bob secret' })
    );

    const results = await storage.getInvoicesBySeller(ALICE, undefined, 50, 0, 'SECRET');

    assert.equal(results.length, 0);
  });
});

/**
 * The endpoints, not only the storage.
 *
 * The cases above drive MemoryInvoiceStorage directly, which proves the filter
 * exists but not that a request reaches it. These go through the real handlers,
 * so a request naming another seller cannot be answered even if a caller forgets
 * to scope: both endpoints refuse without a seller key, scope with one, and the
 * status filter runs inside that scope.
 */
interface FakeResponse {
  statusCode: number;
  body: any;
}

function createRes(): FakeResponse & Response {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function createReq(init: { body?: any; query?: any } = {}): Request {
  return { body: init.body || {}, params: {}, query: init.query || {} } as unknown as Request;
}

async function call(
  handler: (req: Request, res: Response) => Promise<void>,
  req: Request
): Promise<FakeResponse> {
  const res = createRes();
  await handler(req, res);
  return res;
}

describe('wallet-scoped invoice endpoints', () => {
  const makeApi = () => {
    const storage = new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage()));
    return { handlers: createInvoiceHandlers({ storage }), storage };
  };

  /** Seed through the real create handler, so the endpoint reads real rows. */
  async function seedThroughApi(handlers: any) {
    for (const [sellerPublicKey, amount] of [
      [ALICE, 25],
      [ALICE, 40],
      [BOB, 10],
    ] as const) {
      const res = await call(
        handlers.createInvoice as any,
        createReq({ body: { sellerPublicKey, amount, assetCode: 'XLM', expiresInDays: 7 } })
      );
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    }
  }

  it('answers a list request with only the requesting seller rows', async () => {
    const { handlers } = makeApi();
    await seedThroughApi(handlers);

    const res = await call(handlers.getInvoices as any, createReq({ query: { sellerPublicKey: ALICE } }));

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.length, 2);
    for (const row of res.body.data) {
      assert.equal(row.sellerPublicKey, ALICE);
    }
  });

  it('keeps the status filter inside the seller scope', async () => {
    const { handlers, storage } = makeApi();
    await seedThroughApi(handlers);

    const bob = (await call(handlers.getInvoices as any, createReq({ query: { sellerPublicKey: BOB } })))
      .body.data;
    await storage.markAsPaid(bob[0].id, 'b'.repeat(64), CAROL);

    const paidForAlice = await call(
      handlers.getInvoices as any,
      createReq({ query: { sellerPublicKey: ALICE, status: 'PAID' } })
    );
    const paidForBob = await call(
      handlers.getInvoices as any,
      createReq({ query: { sellerPublicKey: BOB, status: 'PAID' } })
    );

    assert.equal(paidForAlice.body.data.length, 0, 'Alice has no paid invoices');
    assert.equal(paidForBob.body.data.length, 1, 'Bob still sees his own paid invoice');
    assert.equal(paidForBob.body.data[0].sellerPublicKey, BOB);
  });

  it('counts stats per wallet through the endpoint', async () => {
    const { handlers } = makeApi();
    await seedThroughApi(handlers);

    const alice = await call(handlers.getStats as any, createReq({ query: { sellerPublicKey: ALICE } }));
    const bob = await call(handlers.getStats as any, createReq({ query: { sellerPublicKey: BOB } }));

    assert.equal(alice.statusCode, 200);
    assert.equal(alice.body.data[0].total_invoices, 2);
    assert.equal(bob.body.data[0].total_invoices, 1);
  });

  it('refuses a list or stats request that names no seller', async () => {
    const { handlers } = makeApi();
    await seedThroughApi(handlers);

    const list = await call(handlers.getInvoices as any, createReq({}));
    const stats = await call(handlers.getStats as any, createReq({}));

    assert.equal(list.statusCode, 400);
    assert.equal(stats.statusCode, 400);
  });

  it('refuses a seller key that is not a Stellar account id', async () => {
    const { handlers } = makeApi();
    await seedThroughApi(handlers);

    const list = await call(handlers.getInvoices as any, createReq({ query: { sellerPublicKey: 'nope' } }));
    const stats = await call(handlers.getStats as any, createReq({ query: { sellerPublicKey: 'nope' } }));

    assert.equal(list.statusCode, 400);
    assert.equal(stats.statusCode, 400);
  });

  it('filters invoices by search query through the endpoint', async () => {
    const { handlers } = makeApi();
    await seedThroughApi(handlers);

    const aliceRes = await call(
      handlers.getInvoices as any,
      createReq({ query: { sellerPublicKey: ALICE, q: 'INV' } })
    );

    assert.equal(aliceRes.statusCode, 200);
    assert.equal(aliceRes.body.data.length, 2);

    const noMatchRes = await call(
      handlers.getInvoices as any,
      createReq({ query: { sellerPublicKey: ALICE, q: 'NONEXISTENT' } })
    );

    assert.equal(noMatchRes.statusCode, 200);
    assert.equal(noMatchRes.body.data.length, 0);
  });

  it('endpoint never leaks another seller invoices when searching', async () => {
    const { handlers } = makeApi();
    await seedThroughApi(handlers);

    const bobRes = await call(
      handlers.getInvoices as any,
      createReq({ query: { sellerPublicKey: BOB } })
    );
    const bobMemo = bobRes.body.data[0].memo;

    const aliceRes = await call(
      handlers.getInvoices as any,
      createReq({ query: { sellerPublicKey: ALICE, q: bobMemo } })
    );

    assert.equal(aliceRes.statusCode, 200);
    assert.ok(aliceRes.body.data.every((row: any) => row.sellerPublicKey === ALICE));
    assert.ok(!aliceRes.body.data.some((row: any) => row.id === bobRes.body.data[0].id));
  });
});
