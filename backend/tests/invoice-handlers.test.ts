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
import { PUBLIC_INVOICE_FIELDS } from '../../shared/invoice.ts';

const SELLER_A = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const SELLER_B = 'GB6IHEZ4QNOHJZRYRFLOC45P4SK3KKL6KNPI5WEG6FNVSZ2K5FS2MNY7';
const PAYER = 'GCBIBQVH2B3STCBIYSMTQH6DWKSB2XUGLXH7RGPIN3OXPCFCIQEICVZ6';
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

function createReq(init: { body?: any; params?: any; query?: any; headers?: any } = {}): Request {
  return {
    body: init.body || {},
    params: init.params || {},
    query: init.query || {},
    headers: init.headers || {},
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
      const idempotencyKey = params[13] ?? null;
      // ON CONFLICT (seller_public_key, idempotency_key) DO NOTHING — the fake
      // honours the partial unique index by returning no row on a replay.
      if (idempotencyKey !== null) {
        const clash = rows.find(
          (row) =>
            row.seller_public_key === params[1] && row.idempotency_key === idempotencyKey
        );
        if (clash) {
          return { rows: [], rowCount: 0 };
        }
      }
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
        cancelled_at: null,
        settled_at: null,
        settlement_context: null,
        prior_status: null,
        late_payment_warning_code: null,
        metadata: null,
        idempotency_key: idempotencyKey,
      };
      rows.push(row);
      return { rows: [clone(row)], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE seller_public_key = $1 AND idempotency_key')) {
      const found = rows.filter(
        (row) => row.seller_public_key === params[0] && row.idempotency_key === params[1]
      );
      return { rows: found.map(clone), rowCount: found.length };
    }

    if (sql.startsWith('INSERT INTO payment_events')) {
      events.push({
        id: `evt-${events.length + 1}`,
        invoiceId: params[0],
        eventType: params[1],
        eventData: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2] ?? null,
        createdAt: new Date(),
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT id, invoice_id, event_type, event_data, created_at FROM payment_events')) {
      const found = events
        .filter((event) => event.invoiceId === params[0])
        .map((event) => ({
          id: event.id,
          invoice_id: event.invoiceId,
          event_type: event.eventType,
          event_data: event.eventData,
          created_at: event.createdAt,
        }));
      return { rows: found.map(clone), rowCount: found.length };
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

    if (sql.startsWith("UPDATE invoices SET status = 'PAID'") || sql.startsWith('WITH settled AS')) {
      const settledAt = params[5] ? new Date(params[5]) : new Date();
      const row = rows.find(
        candidate => candidate.id === params[0] &&
          (
            (candidate.status === 'PENDING' && new Date(candidate.expires_at).getTime() > Date.now()) ||
            (candidate.status === 'CANCELLED' && candidate.cancelled_at && Number.isFinite(settledAt.getTime()))
          )
      );
      if (!row) {
        return { rows: [], rowCount: 0 };
      }
      const priorStatus = row.status;
      const afterCancel =
        priorStatus === 'CANCELLED' &&
        settledAt.getTime() >= new Date(row.cancelled_at).getTime();
      Object.assign(row, {
        status: 'PAID',
        payment_tx_hash: params[1],
        payer_public_key: params[2],
        payer_name: params[3],
        payer_email: params[4],
        paid_at: new Date(),
        settled_at: settledAt,
        settlement_context: afterCancel ? 'AFTER_CANCEL' : 'ON_TIME',
        prior_status: priorStatus === 'CANCELLED' ? 'CANCELLED' : null,
        late_payment_warning_code: afterCancel ? 'PAYMENT_RECEIVED_AFTER_CANCEL' : null,
      });
      return { rows: [clone(row)], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'CANCELLED'")) {
      const sellerPublicKey = params[1] ?? null;
      const row = rows.find(
        candidate => candidate.id === params[0] &&
          candidate.status === 'PENDING' &&
          (!sellerPublicKey || candidate.seller_public_key === sellerPublicKey)
      );
      if (!row) {
        return { rows: [], rowCount: 0 };
      }
      row.status = 'CANCELLED';
      row.cancelled_at = new Date();
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
    transaction: { memo: overrides.memo, created_at: new Date().toISOString() },
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

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

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

    it('round-trips all seller, payer, asset, customer and expiry parity fields through create+get+verify+list', async () => {
      const sellerName = 'Round-trip Studio';
      const sellerEmail = 'studio@roundtrip.example';
      const customerName = 'Client Co';
      const customerEmail = 'pay@client.example';
      const payerName = 'Percy Payer';
      const payerEmail = 'percy@payer.example';

      const created = await createInvoice({
        amount: 88.25,
        assetCode: 'USDC',
        assetIssuer: USDC_ISSUER,
        sellerName,
        sellerEmail,
        customerName,
        customerEmail,
        expiresInDays: 5,
      });

      assert.equal(created.sellerName, sellerName);
      assert.equal(created.sellerEmail, sellerEmail);
      assert.equal(created.customerName, customerName);
      assert.equal(created.customerEmail, customerEmail);
      assert.equal(created.assetCode, 'USDC');
      assert.equal(created.assetIssuer, USDC_ISSUER);
      assert.equal(created.status, 'PENDING');

      const lifetimeHours = (new Date(created.expiresAt).getTime() - new Date(created.createdAt).getTime()) / (60 * 60 * 1000);
      assert.ok(lifetimeHours >= 5 * 24 - 1, `5-day expiry window should be ~120h, got ${lifetimeHours}h`);

      const got = await call(
        handlers().getInvoice,
        createReq({ params: { id: created.id }, query: { sellerPublicKey: SELLER_A } })
      );
      assert.equal(got.statusCode, 200);
      assert.equal(got.body.data.sellerName, sellerName);
      assert.equal(got.body.data.assetIssuer, USDC_ISSUER);
      assert.equal(got.body.data.customerEmail, customerEmail);

      transaction = {
        transaction: { memo: created.memo, created_at: new Date().toISOString() },
        operations: [
          {
            type: 'payment',
            from: PAYER,
            to: SELLER_A,
            amount: '88.2500000',
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: USDC_ISSUER,
          },
        ],
      };

      const verified = await call(
        handlers().verifyPayment,
        createReq({
          params: { id: created.id },
          body: { txHash: TX_HASH, payerName, payerEmail },
        })
      );

      assert.equal(verified.statusCode, 200);
      assert.equal(verified.body.data.paymentTxHash, TX_HASH);
      assert.ok(verified.body.data.paidAt, 'paidAt must be set after verify');
      assert.equal(verified.body.data.status, 'PAID');

      // Payer identity is workspace-scoped (#503): the verify response is the
      // public shape, so read the stored record back through the seller view.
      const sellerView = await call(
        handlers().getInvoice,
        createReq({ params: { id: created.id }, query: { sellerPublicKey: SELLER_A } })
      );
      assert.equal(sellerView.body.data.payerName, payerName);
      assert.equal(sellerView.body.data.payerEmail, payerEmail);
      assert.equal(sellerView.body.data.payerPublicKey, PAYER);

      const listed = await call(
        handlers().getInvoices,
        createReq({ query: { sellerPublicKey: SELLER_A, status: 'PAID' } })
      );
      assert.equal(listed.statusCode, 200);
      assert.equal(listed.body.data.length >= 1, true);
      const paidListed = listed.body.data.find((inv: any) => inv.id === created.id);
      assert.equal(paidListed?.payerName, payerName);
      assert.equal(paidListed?.assetIssuer, USDC_ISSUER);
      assert.equal(paidListed?.sellerEmail, sellerEmail);
    });

    describe('seller payment-events feed (issue #515)', () => {
      it('lists a rejected verify for the owning seller', async () => {
        const invoice = await createInvoice();
        transaction = {
          transaction: { memo: 'someone-elses-memo' },
          operations: [
            {
              type: 'payment',
              from: PAYER,
              to: SELLER_A,
              amount: '42.5000000',
              asset_type: 'native',
            },
          ],
        };

        const rejected = await call(
          handlers().verifyPayment,
          createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
        );
        assert.equal(rejected.statusCode, 400);

        const res = await call(
          handlers().getPaymentEvents,
          createReq({ params: { id: invoice.id }, query: { sellerPublicKey: SELLER_A } })
        );
        assert.equal(res.statusCode, 200);
        const reject = res.body.data.find((e: any) => e.eventType === 'PAYMENT_REJECTED');
        assert.ok(reject, 'the rejected verify must land on the seller feed');
        assert.equal(reject.eventData.code, 'MEMO_MISMATCH');
        assert.equal(reject.eventData.txHash, TX_HASH);
      });

      it('refuses a foreign wallet with 403', async () => {
        const invoice = await createInvoice();
        const res = await call(
          handlers().getPaymentEvents,
          createReq({ params: { id: invoice.id }, query: { sellerPublicKey: SELLER_B } })
        );
        assert.equal(res.statusCode, 403);
      });

      it('requires a valid seller key — 400 when missing or malformed', async () => {
        const invoice = await createInvoice();
        const missing = await call(
          handlers().getPaymentEvents,
          createReq({ params: { id: invoice.id } })
        );
        assert.equal(missing.statusCode, 400);
        const bad = await call(
          handlers().getPaymentEvents,
          createReq({ params: { id: invoice.id }, query: { sellerPublicKey: 'nope' } })
        );
        assert.equal(bad.statusCode, 400);
      });

      it('redacts identity-shaped keys from event payloads', async () => {
        const invoice = await createInvoice();
        await storage.logPaymentEvent!(invoice.id, 'PAYMENT_REJECTED', {
          code: 'MEMO_MISMATCH',
          txHash: TX_HASH,
          memo: 'INV-RAW-MEMO-LEAK',
          payerEmail: 'payer@wallet.example',
          nested: { customerName: 'Client Co', amount: '42.5' },
        });

        const res = await call(
          handlers().getPaymentEvents,
          createReq({ params: { id: invoice.id }, query: { sellerPublicKey: SELLER_A } })
        );
        assert.equal(res.statusCode, 200);
        const event = res.body.data[0];
        assert.equal(event.eventData.code, 'MEMO_MISMATCH');
        assert.equal(event.eventData.memo, undefined);
        assert.equal(event.eventData.payerEmail, undefined);
        assert.equal(event.eventData.nested.customerName, undefined);
        assert.equal(event.eventData.nested.amount, '42.5');
      });
    });

    describe('idempotent create (issue #514)', () => {
      it('replays an explicit Idempotency-Key to the original invoice', async () => {
        const body = invoiceBody();
        const first = await call(
          handlers().createInvoice,
          createReq({ body, headers: { 'idempotency-key': 'form-abc-123' } })
        );
        const second = await call(
          handlers().createInvoice,
          createReq({ body, headers: { 'idempotency-key': 'form-abc-123' } })
        );

        assert.equal(first.statusCode, 201);
        assert.equal(second.statusCode, 201);
        assert.equal(second.body.data.invoice.id, first.body.data.invoice.id);
        assert.equal(second.body.data.invoice.memo, first.body.data.invoice.memo);
        assert.equal(second.body.data.paymentUrl, first.body.data.paymentUrl);
      });

      it('collapses parallel creates carrying the same key onto one invoice', async () => {
        const body = invoiceBody();
        const [a, b] = await Promise.all([
          call(
            handlers().createInvoice,
            createReq({ body, headers: { 'idempotency-key': 'double-click-1' } })
          ),
          call(
            handlers().createInvoice,
            createReq({ body, headers: { 'idempotency-key': 'double-click-1' } })
          ),
        ]);

        assert.equal(a.statusCode, 201);
        assert.equal(b.statusCode, 201);
        assert.equal(a.body.data.invoice.id, b.body.data.invoice.id);
        assert.equal(a.body.data.invoice.memo, b.body.data.invoice.memo);
      });

      it('dedupes a keyless retry of the same intent inside the window', async () => {
        const first = await call(
          handlers().createInvoice,
          createReq({ body: invoiceBody({ customerEmail: 'same@client.example' }) })
        );
        const second = await call(
          handlers().createInvoice,
          createReq({ body: invoiceBody({ customerEmail: 'same@client.example' }) })
        );

        assert.equal(first.statusCode, 201);
        assert.equal(second.statusCode, 201);
        assert.equal(second.body.data.invoice.id, first.body.data.invoice.id);
      });

      it('mints a new invoice when the intent differs', async () => {
        const first = await call(
          handlers().createInvoice,
          createReq({ body: invoiceBody({ amount: 10 }) })
        );
        const second = await call(
          handlers().createInvoice,
          createReq({ body: invoiceBody({ amount: 99 }) })
        );

        assert.equal(first.statusCode, 201);
        assert.equal(second.statusCode, 201);
        assert.notEqual(second.body.data.invoice.id, first.body.data.invoice.id);
        assert.notEqual(second.body.data.invoice.memo, first.body.data.invoice.memo);
      });

      it('scopes an explicit key to the seller wallet', async () => {
        const first = await call(
          handlers().createInvoice,
          createReq({ body: invoiceBody(), headers: { 'idempotency-key': 'shared-key' } })
        );
        const other = await call(
          handlers().createInvoice,
          createReq({
            body: invoiceBody({ sellerPublicKey: SELLER_B }),
            headers: { 'idempotency-key': 'shared-key' },
          })
        );

        assert.equal(first.statusCode, 201);
        assert.equal(other.statusCode, 201);
        assert.notEqual(other.body.data.invoice.id, first.body.data.invoice.id);
        assert.equal(other.body.data.invoice.sellerPublicKey, SELLER_B);
      });

      it('rejects a malformed Idempotency-Key header', async () => {
        const res = await call(
          handlers().createInvoice,
          createReq({ body: invoiceBody(), headers: { 'idempotency-key': 'bad key!' } })
        );
        assert.equal(res.statusCode, 400);
      });
    });

    describe('public pay DTO (issue #503)', () => {
      const PII_KEYS = [
        'customerName',
        'customerEmail',
        'sellerName',
        'sellerEmail',
        'payerPublicKey',
        'payerName',
        'payerEmail',
        'description',
        'metadata',
        'userId',
      ];

      it('returns the public shape to an anonymous caller — no client or identity fields', async () => {
        const created = await createInvoice({
          customerName: 'Client Co',
          customerEmail: 'pay@client.example',
          sellerName: 'Studio',
          sellerEmail: 'studio@example.com',
          description: 'Invoice for design work',
        });

        const res = await call(
          handlers().getInvoice,
          createReq({ params: { id: created.id } })
        );
        assert.equal(res.statusCode, 200);
        for (const key of PII_KEYS) {
          assert.equal(res.body.data[key], undefined, `public DTO leaked ${key}`);
        }
        assert.equal(res.body.data.id, created.id);
        assert.equal(res.body.data.sellerPublicKey, SELLER_A);
        assert.equal(res.body.data.amount, 42.5);
        assert.equal(res.body.data.memo, created.memo);
        assert.equal(res.body.data.status, 'PENDING');
        assert.ok(res.body.data.expiresAt, 'public DTO must keep expiresAt');
        for (const key of Object.keys(res.body.data)) {
          assert.ok(
            PUBLIC_INVOICE_FIELDS.includes(key as any),
            `public DTO carries non-whitelisted key ${key}`
          );
        }
      });

      it('returns the public shape to a foreign wallet', async () => {
        const created = await createInvoice({ customerEmail: 'pay@client.example' });

        const res = await call(
          handlers().getInvoice,
          createReq({ params: { id: created.id }, query: { sellerPublicKey: SELLER_B } })
        );
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.customerEmail, undefined);
        assert.equal(res.body.data.id, created.id);
      });

      it('returns the full workspace shape to the invoice seller', async () => {
        const created = await createInvoice({
          customerName: 'Client Co',
          customerEmail: 'pay@client.example',
        });

        const res = await call(
          handlers().getInvoice,
          createReq({ params: { id: created.id }, query: { sellerPublicKey: SELLER_A } })
        );
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.customerEmail, 'pay@client.example');
        assert.equal(res.body.data.customerName, 'Client Co');
      });

      it('rejects a malformed sellerPublicKey hint with 400', async () => {
        const created = await createInvoice();

        const res = await call(
          handlers().getInvoice,
          createReq({ params: { id: created.id }, query: { sellerPublicKey: 'not-a-wallet' } })
        );
        assert.equal(res.statusCode, 400);
      });

      it('keeps the payment-info payload on the public shape', async () => {
        const created = await createInvoice({
          customerEmail: 'pay@client.example',
          sellerEmail: 'studio@example.com',
        });

        const res = await call(
          handlers().getPaymentInfo,
          createReq({ params: { id: created.id } })
        );
        assert.equal(res.statusCode, 200);
        for (const key of PII_KEYS) {
          assert.equal(res.body.data.invoice[key], undefined, `payment-info leaked ${key}`);
        }
        assert.equal(res.body.data.invoice.memo, created.memo);
      });

      it('keeps the verify response on the public shape', async () => {
        const created = await createInvoice({ customerEmail: 'pay@client.example' });
        transaction = paymentTransaction({
          memo: created.memo,
          amount: '42.5000000',
          to: SELLER_A,
        });

        const res = await call(
          handlers().verifyPayment,
          createReq({
            params: { id: created.id },
            body: { txHash: TX_HASH, payerEmail: 'percy@payer.example' },
          })
        );
        assert.equal(res.statusCode, 200);
        for (const key of PII_KEYS) {
          assert.equal(res.body.data[key], undefined, `verify response leaked ${key}`);
        }
        assert.equal(res.body.data.status, 'PAID');
        assert.equal(res.body.data.paymentTxHash, TX_HASH);
      });
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
      // The XLM URI fits the QR budget, so the code encodes it directly and
      // the payer still sees the full SEP-0007 string as copyable text.
      assert.match(res.body.data.stellarUri, /^web\+stellar:pay\?/);
      assert.equal(res.body.data.stellarQrEncodesUri, true);
      assert.equal(res.body.data.statusPollingIntervalMs, 3000);
      assert.equal(res.body.data.paymentAvailable, true);
    });

    it('builds a SEP-0007 QR for a one-stroop invoice amount', async () => {
      // 0.0000001 arrives as the float 1e-7; the QR payload must be formatted
      // through the stroop helper, not `toString()`, which emits '1e-7' and
      // fails the SEP-0007 amount schema.
      const res = await call(
        handlers().createInvoice,
        createReq({ body: invoiceBody({ amount: 0.0000001 }) })
      );

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.data.invoice.amount, 0.0000001);
      assert.match(res.body.data.stellarQrCode, /^data:image\/png;base64,/);
    });

    it('falls back to the HTTPS pay link when a USDC URI exceeds the QR budget (#510)', async () => {
      const res = await call(
        handlers().createInvoice,
        createReq({
          body: invoiceBody({ assetCode: 'USDC', assetIssuer: USDC_ISSUER }),
        })
      );

      assert.equal(res.statusCode, 201);
      const data = res.body.data;
      assert.equal(data.stellarQrEncodesUri, false);
      assert.match(data.stellarQrCode, /^data:image\/png;base64,/);
      // The full SEP-0007 URI — issuer and memo intact — is still returned
      // for copy / open-in-wallet even though the QR encodes the pay link.
      assert.match(data.stellarUri, /^web\+stellar:pay\?/);
      assert.match(data.stellarUri, /asset_code=USDC/);
      assert.match(data.stellarUri, new RegExp(`asset_issuer=${USDC_ISSUER}`));
      assert.match(data.stellarUri, /memo=/);
    });

    it('normalizes lowercase assetCode to uppercase on creation', async () => {
      const res = await call(
        handlers().createInvoice,
        createReq({ body: invoiceBody({ assetCode: 'xlm' }) })
      );

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.data.invoice.assetCode, 'XLM');
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

    it('expires lazily and closes payment issuance and actionable stats', async () => {
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

      // Late payments still settle: verification on an expired invoice proceeds
      // to the ledger and only rejects because no matching transaction exists.
      transaction = paymentTransaction({ memo: 'INV-UNRELATED', amount: '42.5000000', to: SELLER_A });
      const verify = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );
      assert.equal(verify.statusCode, 400);
      assert.equal(verify.body.code, 'MEMO_MISMATCH');

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

      const stored = await storage.getInvoiceById(invoice.id);
      assert.equal(stored?.status, 'PAID');
      assert.equal(stored?.payerPublicKey, PAYER);
      assert.equal(stored?.payerName, 'Ada');
      assert.equal(stored?.payerEmail, 'ada@example.com');
    });

    it('requires a transaction hash to verify', async () => {
      const invoice = await createInvoice();

      const res = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: {} })
      );

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.code, 'MISSING_TX_HASH');
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
      assert.equal(res.body.code, 'MEMO_MISMATCH');
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
      assert.equal(res.body.code, 'DESTINATION_MISMATCH');
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
      assert.equal(res.body.code, 'AMOUNT_TOO_LOW');
      assert.equal(res.body.error, 'Payment is less than the invoice amount');
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
      assert.equal(res.body.code, 'INVOICE_ALREADY_PAID');
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
        createReq({ params: { id: invoice.id }, body: { sellerPublicKey: SELLER_A } })
      );
      assert.equal(cancelled.statusCode, 200);
      assert.equal(cancelled.body.data.status, 'CANCELLED');

      const again = await call(
        handlers().cancelInvoice,
        createReq({ params: { id: invoice.id }, body: { sellerPublicKey: SELLER_A } })
      );
      assert.equal(again.statusCode, 400);
      assert.equal(again.body.success, false);
    });

    it('cancels a pending invoice when sellerPublicKey matches', async () => {
      const invoice = await createInvoice();

      const cancelled = await call(
        handlers().cancelInvoice,
        createReq({ params: { id: invoice.id }, body: { sellerPublicKey: SELLER_A } })
      );
      assert.equal(cancelled.statusCode, 200);
      assert.equal(cancelled.body.data.status, 'CANCELLED');
    });

    it('rejects cancellation when sellerPublicKey does not match (403)', async () => {
      const invoice = await createInvoice();

      const res = await call(
        handlers().cancelInvoice,
        createReq({ params: { id: invoice.id }, body: { sellerPublicKey: SELLER_B } })
      );
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.error, /unauthorized/i);
    });

    it('rejects invalid sellerPublicKey format on cancel (400)', async () => {
      const invoice = await createInvoice();

      const res = await call(
        handlers().cancelInvoice,
        createReq({ params: { id: invoice.id }, body: { sellerPublicKey: 'not-a-valid-stellar-key' } })
      );
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.success, false);
    });

    // Issue #517 — one proof path: seller key, signature and message all live
    // in the JSON body. Query params and headers are legacy transports; a
    // disagreeing duplicate fails closed instead of smuggling a second key.
    it('rejects cancel when body and query seller keys disagree (400)', async () => {
      const invoice = await createInvoice();

      const res = await call(
        handlers().cancelInvoice,
        createReq({
          params: { id: invoice.id },
          body: { sellerPublicKey: SELLER_A },
          query: { sellerPublicKey: SELLER_B },
        })
      );
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /conflicting/i);
    });

    it('rejects cancel when body and header seller keys disagree (400)', async () => {
      const invoice = await createInvoice();

      const res = await call(
        handlers().cancelInvoice,
        createReq({
          params: { id: invoice.id },
          body: { sellerPublicKey: SELLER_A },
          headers: { 'x-seller-public-key': SELLER_B },
        })
      );
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /conflicting/i);
    });

    it('rejects a query-only seller key — the body is the one transport (400)', async () => {
      const invoice = await createInvoice();

      const res = await call(
        handlers().cancelInvoice,
        createReq({ params: { id: invoice.id }, query: { sellerPublicKey: SELLER_A } })
      );
      assert.equal(res.statusCode, 400);
    });

    it('tolerates a duplicate query key that agrees with the body', async () => {
      const invoice = await createInvoice();

      const res = await call(
        handlers().cancelInvoice,
        createReq({
          params: { id: invoice.id },
          body: { sellerPublicKey: SELLER_A },
          query: { sellerPublicKey: SELLER_A },
        })
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.status, 'CANCELLED');
    });

    it('requires a signature when requireCancelSignature is set (401)', async () => {
      const invoice = await createInvoice();

      const res = await call(
        createInvoiceHandlers({
          storage,
          frontendUrl: 'http://localhost:3000',
          allowSimulate: false,
          stellar: { getTransaction: async () => transaction },
          requireCancelSignature: true,
        }).cancelInvoice,
        createReq({ params: { id: invoice.id }, body: { sellerPublicKey: SELLER_A } })
      );
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'UNAUTHORIZED');
    });

    it('cancels PENDING with a valid cancel:<id> signature', async () => {
      const { Keypair } = await import('@stellar/stellar-sdk');
      const keypair = Keypair.random();
      const seller = keypair.publicKey();
      const invoice = await createInvoice({ sellerPublicKey: seller });
      const signature = keypair.sign(Buffer.from(`cancel:${invoice.id}`)).toString('base64');

      const res = await call(
        createInvoiceHandlers({
          storage,
          frontendUrl: 'http://localhost:3000',
          allowSimulate: false,
          stellar: { getTransaction: async () => transaction },
          requireCancelSignature: true,
        }).cancelInvoice,
        createReq({
          params: { id: invoice.id },
          body: { sellerPublicKey: seller, signature },
        })
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.status, 'CANCELLED');
    });

    it('rejects a signature over a different message (401)', async () => {
      const { Keypair } = await import('@stellar/stellar-sdk');
      const keypair = Keypair.random();
      const seller = keypair.publicKey();
      const invoice = await createInvoice({ sellerPublicKey: seller });
      // Signed the bare id — the contract is exactly `cancel:<id>`.
      const signature = keypair.sign(Buffer.from(invoice.id)).toString('base64');

      const res = await call(
        createInvoiceHandlers({
          storage,
          frontendUrl: 'http://localhost:3000',
          allowSimulate: false,
          stellar: { getTransaction: async () => transaction },
          requireCancelSignature: true,
        }).cancelInvoice,
        createReq({
          params: { id: invoice.id },
          body: { sellerPublicKey: seller, signature },
        })
      );
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'INVALID_SIGNATURE');
    });

    it('rejects a foreign signer even with a valid signature (403)', async () => {
      const { Keypair } = await import('@stellar/stellar-sdk');
      const foreign = Keypair.random();
      const invoice = await createInvoice();
      const signature = foreign.sign(Buffer.from(`cancel:${invoice.id}`)).toString('base64');

      const res = await call(
        createInvoiceHandlers({
          storage,
          frontendUrl: 'http://localhost:3000',
          allowSimulate: false,
          stellar: { getTransaction: async () => transaction },
          requireCancelSignature: true,
        }).cancelInvoice,
        createReq({
          params: { id: invoice.id },
          body: { sellerPublicKey: foreign.publicKey(), signature },
        })
      );
      assert.equal(res.statusCode, 403);
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
      'GET /invoices/:id/events',
      'GET /invoices/:id/payment-info',
      'POST /invoices/:id/cancel',
      'POST /invoices/:id/verify',
      'POST /invoices/:id/simulate-payment',
    ];

    assert.deepEqual(routeTable(new MemoryInvoiceStorage()), expected);
    assert.deepEqual(routeTable(new PostgresInvoiceStorage()), expected);
  });
});
