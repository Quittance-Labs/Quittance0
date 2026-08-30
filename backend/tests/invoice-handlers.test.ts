import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import type { Request, Response } from 'express';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers.ts';
import { createInvoiceRouter } from '../src/routes/invoice.routes.ts';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage.ts';
import { PostgresInvoiceStorage } from '../src/storage/postgres-invoice-storage.ts';
import { InvoiceService } from '../src/services/invoice.service.ts';
import memoryStorage from '../src/storage/memory-storage.ts';
import type { InvoiceStorage } from '../src/storage/invoice-storage.ts';

const SELLER_A = 'G' + 'A'.repeat(55);
const SELLER_B = 'G' + 'B'.repeat(55);
const PAYER = 'G' + 'C'.repeat(55);
const TX_HASH = 'a'.repeat(64);

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

function createReq(init: { body?: any; params?: any; query?: any } = {}): Request {
  return {
    body: init.body || {},
    params: init.params || {},
    query: init.query || {},
  } as unknown as Request;
}

async function call(
  handler: (req: Request, res: Response) => Promise<void>,
  req: Request
): Promise<FakeResponse> {
  const res = createRes();
  await handler(req, res);
  return res;
}

/**
 * Minimal Postgres stand-in: understands only the statements invoice.service
 * issues, so the SQL parameter order and row mapping stay under test.
 */
function createFakePostgres() {
  const rows: any[] = [];
  const events: any[] = [];
  const clone = (row: any) => ({ ...row });

  const query = async (text: string, params: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('INSERT INTO invoices')) {
      const row = {
        id: params[0],
        seller_public_key: params[1],
        seller_name: params[2],
        seller_email: params[3],
        // Postgres returns DECIMAL columns as strings.
        amount: String(params[4]),
        asset_code: params[5],
        asset_issuer: params[6],
        memo: params[7],
        description: params[8],
        customer_name: params[9],
        customer_email: params[10],
        status: params[11],
        expires_at: params[12],
        payment_tx_hash: null,
        payer_public_key: null,
        payer_name: null,
        payer_email: null,
        created_at: new Date(),
        paid_at: null,
        metadata: null,
      };
      rows.push(row);
      return { rows: [clone(row)], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO payment_events')) {
      events.push({ invoiceId: params[0], eventType: params[1] });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE id =')) {
      const found = rows.filter(row => row.id === params[0]);
      return { rows: found.map(clone), rowCount: found.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE memo =')) {
      const found = rows.filter(row => row.memo === params[0]);
      return { rows: found.map(clone), rowCount: found.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE seller_public_key =')) {
      let found = rows.filter(row => row.seller_public_key === params[0]);
      if (sql.includes('AND status = $2')) {
        found = found.filter(row => row.status === params[1]);
      }
      const offset = params[params.length - 1];
      const limit = params[params.length - 2];
      const page = found
        .slice()
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(offset, offset + limit);
      return { rows: page.map(clone), rowCount: page.length };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'EXPIRED'")) {
      const now = new Date(params[0]).getTime();
      const expired = rows.filter(
        row => row.status === 'PENDING' && new Date(row.expires_at).getTime() <= now
      );
      expired.forEach(row => { row.status = 'EXPIRED'; });
      return { rows: expired.map(row => ({ id: row.id })), rowCount: expired.length };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'PAID'")) {
      const row = rows.find(
        candidate => candidate.id === params[0] &&
          candidate.status === 'PENDING' &&
          new Date(candidate.expires_at).getTime() > Date.now()
      );
      if (!row) {
        return { rows: [], rowCount: 0 };
      }
      Object.assign(row, {
        status: 'PAID',
        payment_tx_hash: params[1],
        payer_public_key: params[2],
        payer_name: params[3],
        payer_email: params[4],
        paid_at: new Date(),
      });
      return { rows: [clone(row)], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'CANCELLED'")) {
      const row = rows.find(
        candidate => candidate.id === params[0] && candidate.status === 'PENDING'
      );
      if (!row) {
        return { rows: [], rowCount: 0 };
      }
      row.status = 'CANCELLED';
      return { rows: [clone(row)], rowCount: 1 };
    }

    if (sql.startsWith('SELECT COUNT(*) as total_invoices')) {
      const owned = rows.filter(row => row.seller_public_key === params[0]);
      const revenue: Record<string, number> = {};
      owned
        .filter(row => row.status === 'PAID')
        .forEach(row => {
          revenue[row.asset_code] = (revenue[row.asset_code] || 0) + Number(row.amount);
        });
      return {
        rows: [
          {
            // Postgres reports aggregates as strings.
            total_invoices: String(owned.length),
            paid_invoices: String(owned.filter(row => row.status === 'PAID').length),
            pending_invoices: String(owned.filter(row => row.status === 'PENDING').length),
            actionable_invoices: String(owned.filter(row => row.status === 'PENDING').length),
            expired_invoices: String(owned.filter(row => row.status === 'EXPIRED').length),
            revenue_by_asset: revenue,
          },
        ],
        rowCount: 1,
      };
    }

    throw new Error(`Unhandled query in fake Postgres: ${sql}`);
  };

  return { query, events };
}

function paymentTransaction(overrides: {
  memo: string;
  amount: string;
  to: string;
  assetType?: string;
  assetCode?: string;
}) {
  return {
    transaction: { memo: overrides.memo },
    operations: [
      {
        type: 'payment',
        from: PAYER,
        to: overrides.to,
        amount: overrides.amount,
        asset_type: overrides.assetType || 'native',
        asset_code: overrides.assetCode,
      },
    ],
  };
}

function invoiceBody(overrides: Record<string, unknown> = {}) {
  return {
    amount: 42.5,
    assetCode: 'XLM',
    description: 'Design work',
    sellerPublicKey: SELLER_A,
    ...overrides,
  };
}

/**
 * Both storage backends must expose identical request/response behaviour.
 */
function runSharedBackendSuite(name: string, createStorage: () => InvoiceStorage) {
  describe(`invoice handlers on ${name} storage`, () => {
    let storage: InvoiceStorage;
    let transaction: any;

    const handlers = () =>
      createInvoiceHandlers({
        storage,
        frontendUrl: 'http://localhost:3000',
        allowSimulate: false,
        stellar: { getTransaction: async () => transaction },
      });

    const createInvoice = async (overrides: Record<string, unknown> = {}) => {
      const res = await call(handlers().createInvoice, createReq({ body: invoiceBody(overrides) }));
      assert.equal(res.statusCode, 201);
      return res.body.data.invoice;
    };

    beforeEach(() => {
      memoryStorage.clear();
      storage = createStorage();
      transaction = undefined;
    });

    it('creates an invoice scoped to the seller wallet', async () => {
      const res = await call(handlers().createInvoice, createReq({ body: invoiceBody() }));

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.invoice.sellerPublicKey, SELLER_A);
      assert.equal(res.body.data.invoice.amount, 42.5);
      assert.equal(res.body.data.invoice.assetCode, 'XLM');
      assert.equal(res.body.data.invoice.status, 'PENDING');
      assert.match(res.body.data.invoice.memo, /^INV-/);
      assert.equal(
        res.body.data.paymentUrl,
        `http://localhost:3000/pay/${res.body.data.invoice.id}`
      );
      assert.match(res.body.data.qrCode, /^data:image\/png;base64,/);
      assert.match(res.body.data.stellarQrCode, /^data:image\/png;base64,/);
      assert.equal(res.body.data.statusPollingIntervalMs, 3000);
      assert.equal(res.body.data.paymentAvailable, true);
    });

    it('accepts seller-selected expiry only within the 1-30 day contract', async () => {
      const invoice = await createInvoice({ expiresInDays: 30 });
      const lifetime = new Date(invoice.expiresAt).getTime() - new Date(invoice.createdAt).getTime();
      assert.ok(lifetime > 29 * 24 * 60 * 60 * 1000);

      for (const expiresInDays of [0, 31, 1.5]) {
        const res = await call(
          handlers().createInvoice,
          createReq({ body: invoiceBody({ expiresInDays }) })
        );
        assert.equal(res.statusCode, 400);
      }
    });

    it('expires lazily and closes payment, verification, and actionable stats', async () => {
      const invoice = await createInvoice({ expiresInDays: 1 });
      await storage.markExpiredInvoices(new Date(new Date(invoice.expiresAt).getTime() + 1));

      const read = await call(
        handlers().getInvoice,
        createReq({ params: { id: invoice.id } })
      );
      assert.equal(read.body.data.status, 'EXPIRED');

      const paymentInfo = await call(
        handlers().getPaymentInfo,
        createReq({ params: { id: invoice.id } })
      );
      assert.equal(paymentInfo.body.data.paymentAvailable, false);
      assert.equal(paymentInfo.body.data.qrCode, null);
      assert.equal(paymentInfo.body.data.stellarQrCode, null);

      const verify = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );
      assert.equal(verify.statusCode, 400);
      assert.equal(verify.body.code, 'INVOICE_EXPIRED');

      const stats = await call(
        handlers().getStats,
        createReq({ query: { sellerPublicKey: SELLER_A } })
      );
      assert.equal(stats.body.data[0].pending_invoices, 0);
      assert.equal(stats.body.data[0].actionable_invoices, 0);
      assert.equal(stats.body.data[0].expired_invoices, 1);
    });

    it('rejects an invoice with an invalid seller wallet', async () => {
      const res = await call(
        handlers().createInvoice,
        createReq({ body: invoiceBody({ sellerPublicKey: 'not-a-wallet' }) })
      );

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.success, false);
      assert.equal(typeof res.body.error, 'string');
    });

    it('verifies a matching Stellar payment and marks the invoice paid', async () => {
      const invoice = await createInvoice();
      transaction = paymentTransaction({
        memo: invoice.memo,
        amount: '42.5000000',
        to: SELLER_A,
      });

      const res = await call(
        handlers().verifyPayment,
        createReq({
          params: { id: invoice.id },
          body: { txHash: TX_HASH, payerName: ' Ada ', payerEmail: ' ada@example.com ' },
        })
      );

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.message, 'Payment verified on Stellar');
      assert.equal(res.body.data.status, 'PAID');
      assert.equal(res.body.data.paymentTxHash, TX_HASH);
      assert.equal(res.body.data.payerPublicKey, PAYER);
      assert.equal(res.body.data.payerName, 'Ada');
      assert.equal(res.body.data.payerEmail, 'ada@example.com');

      const stored = await storage.getInvoiceById(invoice.id);
      assert.equal(stored?.status, 'PAID');
    });

    it('requires a transaction hash to verify', async () => {
      const invoice = await createInvoice();

      const res = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: {} })
      );

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'Transaction hash is required');
    });

    it('rejects a payment whose memo does not match', async () => {
      const invoice = await createInvoice();
      transaction = paymentTransaction({
        memo: 'INV-SOMETHING-ELSE',
        amount: '42.5000000',
        to: SELLER_A,
      });

      const res = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'Memo mismatch');
    });

    it('rejects a payment sent to another wallet', async () => {
      const invoice = await createInvoice();
      transaction = paymentTransaction({
        memo: invoice.memo,
        amount: '42.5000000',
        to: SELLER_B,
      });

      const res = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'Payment destination mismatch');
    });

    it('rejects a payment with the wrong amount', async () => {
      const invoice = await createInvoice();
      transaction = paymentTransaction({
        memo: invoice.memo,
        amount: '1.0000000',
        to: SELLER_A,
      });

      const res = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'Amount mismatch');
    });

    it('refuses to verify an invoice twice', async () => {
      const invoice = await createInvoice();
      transaction = paymentTransaction({
        memo: invoice.memo,
        amount: '42.5000000',
        to: SELLER_A,
      });
      const req = createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } });

      await call(handlers().verifyPayment, req);
      const res = await call(handlers().verifyPayment, req);

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'Invoice has already been paid');
    });

    it('returns 404 when verifying an unknown invoice', async () => {
      const res = await call(
        handlers().verifyPayment,
        createReq({ params: { id: 'missing-id' }, body: { txHash: TX_HASH } })
      );

      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'Invoice not found');
    });

    it('lists only the invoices of the requested wallet', async () => {
      await createInvoice();
      await createInvoice({ sellerPublicKey: SELLER_B });

      const res = await call(
        handlers().getInvoices,
        createReq({ query: { sellerPublicKey: SELLER_A } })
      );

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].sellerPublicKey, SELLER_A);
      assert.deepEqual(res.body.pagination, { limit: 50, offset: 0, total: 1 });
    });

    it('requires a wallet when listing invoices', async () => {
      const res = await call(handlers().getInvoices, createReq());

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'sellerPublicKey query parameter is required');
    });

    it('cancels a pending invoice once', async () => {
      const invoice = await createInvoice();

      const cancelled = await call(
        handlers().cancelInvoice,
        createReq({ params: { id: invoice.id } })
      );
      assert.equal(cancelled.statusCode, 200);
      assert.equal(cancelled.body.data.status, 'CANCELLED');

      const again = await call(
        handlers().cancelInvoice,
        createReq({ params: { id: invoice.id } })
      );
      assert.equal(again.statusCode, 400);
      assert.equal(again.body.success, false);
    });

    it('reports wallet-scoped stats', async () => {
      const invoice = await createInvoice();
      await createInvoice({ sellerPublicKey: SELLER_B, amount: 10 });
      transaction = paymentTransaction({
        memo: invoice.memo,
        amount: '42.5000000',
        to: SELLER_A,
      });
      await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      const res = await call(
        handlers().getStats,
        createReq({ query: { sellerPublicKey: SELLER_A } })
      );

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data[0], {
        total_invoices: 1,
        paid_invoices: 1,
        pending_invoices: 0,
        actionable_invoices: 0,
        expired_invoices: 0,
        revenue_by_asset: { XLM: 42.5 },
      });
    });

    it('hides the simulate endpoint when simulation is disabled', async () => {
      const invoice = await createInvoice();

      const res = await call(
        handlers().simulatePayment,
        createReq({ params: { id: invoice.id } })
      );

      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'Endpoint not found');
    });
  });
}

runSharedBackendSuite('in-memory', () => new MemoryInvoiceStorage());
runSharedBackendSuite(
  'postgres',
  () => new PostgresInvoiceStorage(new InvoiceService(createFakePostgres()))
);

describe('storage adapters', () => {
  it('report the backend they are wired to', () => {
    assert.equal(new MemoryInvoiceStorage().mode, 'in-memory');
    assert.equal(new PostgresInvoiceStorage().mode, 'postgres');
  });
});

describe('shared invoice router', () => {
  const routeTable = (storage: InvoiceStorage) =>
    (createInvoiceRouter({ storage }) as any).stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

  it('exposes the same routes for both backends', () => {
    const expected = [
      'POST /invoices',
      // stats must stay ahead of /invoices/:id or the dynamic route shadows it
      'GET /invoices/stats',
      'GET /invoices',
      'GET /invoices/:id',
      'GET /invoices/:id/payment-info',
      'POST /invoices/:id/cancel',
      'POST /invoices/:id/verify',
      'POST /invoices/:id/simulate-payment',
    ];

    assert.deepEqual(routeTable(new MemoryInvoiceStorage()), expected);
    assert.deepEqual(routeTable(new PostgresInvoiceStorage()), expected);
  });
});
