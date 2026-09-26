import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers.ts';
import { PaymentClaimError } from '../src/domain/payment-attribution.ts';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service.ts';
import { InvoiceService } from '../src/services/invoice.service.ts';
import type { Queryable } from '../src/services/invoice.service.ts';
import {
  PaymentMonitorService,
  type PaymentPageSource,
} from '../src/services/payment-monitor.service.ts';
import type {
  PaymentMonitorCheckpoint,
  PaymentMonitorCheckpointStore,
} from '../src/services/payment-monitor-checkpoint.ts';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage.ts';
import { MemoryStorage } from '../src/storage/memory-storage.ts';
import { PostgresInvoiceStorage } from '../src/storage/postgres-invoice-storage.ts';
import type { InvoiceStorage } from '../src/storage/invoice-storage.ts';

const SELLER = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const PAYER = 'GCBIBQVH2B3STCBIYSMTQH6DWKSB2XUGLXH7RGPIN3OXPCFCIQEICVZ6';
const TX_HASH = 'b'.repeat(64);
const TX_HASH_2 = 'c'.repeat(64);

interface FakeResponse {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
}

function createRes(): FakeResponse & Response {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {},
    set(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
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

function invoiceBody(overrides: Record<string, unknown> = {}) {
  return {
    amount: 42.5,
    assetCode: 'XLM',
    description: 'Race-condition design work',
    sellerPublicKey: SELLER,
    ...overrides,
  };
}

function paymentTransaction(overrides: {
  memo: string;
  createdAt: string;
  amount?: string;
  to?: string;
}) {
  return {
    transaction: {
      hash: TX_HASH,
      memo: overrides.memo,
      memo_type: 'text',
      created_at: overrides.createdAt,
    },
    operations: [
      {
        type: 'payment',
        from: PAYER,
        to: overrides.to ?? SELLER,
        amount: overrides.amount ?? '42.5000000',
        asset_type: 'native',
      },
    ],
  };
}

function isoOffset(value: string | Date, deltaMs: number): string {
  return new Date(new Date(value).getTime() + deltaMs).toISOString();
}

class FakePostgresDb implements Queryable {
  rows: Record<string, any>[] = [];
  events: Array<{ invoiceId: string; eventType: string; eventData: any }> = [];

  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('INSERT INTO invoices')) {
      const row = {
        id: params[0],
        seller_public_key: params[1],
        seller_name: params[2],
        seller_email: params[3],
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
      };
      this.rows.push(row);
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'EXPIRED'")) {
      const now = new Date(params[0]).getTime();
      const expired = this.rows.filter(
        (row) => row.status === 'PENDING' && new Date(row.expires_at).getTime() <= now
      );
      expired.forEach((row) => {
        row.status = 'EXPIRED';
      });
      return { rows: expired.map((row) => ({ id: row.id })), rowCount: expired.length };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'CANCELLED'")) {
      const sellerPublicKey = params[1] ?? null;
      const row = this.rows.find(
        (candidate) =>
          candidate.id === params[0] &&
          candidate.status === 'PENDING' &&
          (!sellerPublicKey || candidate.seller_public_key === sellerPublicKey)
      );
      if (!row) {
        return { rows: [], rowCount: 0 };
      }
      row.status = 'CANCELLED';
      row.cancelled_at = new Date();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (sql.startsWith('SELECT id FROM invoices WHERE payment_tx_hash =')) {
      const holder = this.rows.filter(row => row.payment_tx_hash === params[0]);
      return { rows: holder.map(row => ({ ...row })), rowCount: holder.length };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'PAID'") || sql.startsWith('WITH settled AS')) {
      // Durable claim lock: the partial unique index on payment_tx_hash
      // refuses a second invoice claiming the same transaction (#501).
      const claimed = this.rows.find(
        candidate => candidate.payment_tx_hash === params[1] && candidate.id !== params[0]
      );
      if (claimed) {
        const violation: any = new Error('duplicate key value violates unique constraint');
        violation.code = '23505';
        violation.constraint = 'uq_invoices_payment_tx_hash';
        throw violation;
      }
      const row = this.rows.find((candidate) => candidate.id === params[0]);
      const settledAt = params[5] ? new Date(params[5]) : null;
      const canSettle =
        row &&
        settledAt &&
        Number.isFinite(settledAt.getTime()) &&
        (
          row.status === 'PENDING' ||
          row.status === 'EXPIRED'
        );

      if (!row || !canSettle) {
        return { rows: [], rowCount: 0 };
      }

      const priorStatus = row.status;
      const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
      const afterExpiry = expiresAt
        ? settledAt.getTime() >= expiresAt.getTime()
        : priorStatus === 'EXPIRED';
      const settlementContext = afterExpiry ? 'AFTER_EXPIRY' : 'ON_TIME';
      const warningCode = afterExpiry ? 'PAYMENT_RECEIVED_AFTER_EXPIRY' : null;

      Object.assign(row, {
        status: 'PAID',
        payment_tx_hash: params[1],
        payer_public_key: params[2],
        payer_name: params[3],
        payer_email: params[4],
        paid_at: new Date(),
        settled_at: settledAt,
        settlement_context: settlementContext,
        prior_status: priorStatus !== 'PENDING' || afterExpiry ? priorStatus : null,
        late_payment_warning_code: warningCode,
      });
      this.events.push({
        invoiceId: row.id,
        eventType: 'PAYMENT_CONFIRMED',
        eventData: {
          txHash: params[1],
          payerPublicKey: params[2],
          settledAt: settledAt.toISOString(),
          settlementContext: row.settlement_context,
          priorStatus: row.prior_status,
          latePaymentWarningCode: row.late_payment_warning_code,
          ...(params[6] ? { destinationMuxedId: params[6] } : {}),
        },
      });
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO payment_events')) {
      this.events.push({
        invoiceId: params[0],
        eventType: params[1],
        eventData: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2],
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('FROM payment_events WHERE invoice_id =')) {
      const found = this.events.filter((e) => e.invoiceId === params[0]);
      return {
        rows: found.map((e, idx) => ({
          id: `evt-${idx}`,
          invoice_id: e.invoiceId,
          event_type: e.eventType,
          event_data: e.eventData,
          created_at: new Date(),
        })),
        rowCount: found.length,
      };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE id =')) {
      const found = this.rows.filter((row) => row.id === params[0]);
      return { rows: found.map((row) => ({ ...row })), rowCount: found.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE memo =')) {
      const found = this.rows.filter((row) => row.memo === params[0]);
      return { rows: found.map((row) => ({ ...row })), rowCount: found.length };
    }

    throw new Error(`Unhandled query in fake Postgres: ${sql}`);
  }
}

function createMemoryStorage(): InvoiceStorage {
  return new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage()));
}

function createPostgresStorage(): InvoiceStorage {
  return new PostgresInvoiceStorage(new InvoiceService(new FakePostgresDb()));
}

function runManualVerifySuite(name: string, createStorage: () => InvoiceStorage) {
  describe(`cancel versus payment manual verification on ${name}`, () => {
    let storage: InvoiceStorage;
    let transaction: any;

    const handlers = () =>
      createInvoiceHandlers({
        storage,
        frontendUrl: 'http://localhost:3000',
        allowSimulate: false,
        stellar: { getTransaction: async () => transaction },
      });

    const createInvoice = async () => {
      const res = await call(handlers().createInvoice, createReq({ body: invoiceBody() }));
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      return res.body.data.invoice;
    };

    const cancelInvoice = async (invoiceId: string) => {
      const res = await call(
        handlers().cancelInvoice,
        createReq({ params: { id: invoiceId }, body: { sellerPublicKey: SELLER } })
      );
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'CANCELLED');
      assert.ok(res.body.data.cancelledAt, 'cancellation must record cancelledAt');
      return res.body.data;
    };

    beforeEach(() => {
      storage = createStorage();
      transaction = undefined;
    });

    it('rejects payment verification when the invoice has already been cancelled', async () => {
      const invoice = await createInvoice();
      const cancelled = await cancelInvoice(invoice.id);
      const settledAt = isoOffset(cancelled.cancelledAt, 1000);
      transaction = paymentTransaction({ memo: invoice.memo, createdAt: settledAt });

      const verified = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      assert.equal(verified.statusCode, 400, JSON.stringify(verified.body));
      assert.equal(verified.body.success, false);
      assert.equal(verified.body.code, 'INVOICE_NOT_PENDING');

      const stored = await storage.getInvoiceById(invoice.id);
      assert.equal(stored?.status, 'CANCELLED');
      assert.equal(Boolean(stored?.paymentTxHash), false);
    });

    it('keeps a cancelled invoice unchanged when the later transaction mismatches', async () => {
      const invoice = await createInvoice();
      const cancelled = await cancelInvoice(invoice.id);
      transaction = paymentTransaction({
        memo: invoice.memo,
        amount: '41.0000000',
        createdAt: isoOffset(cancelled.cancelledAt, 1000),
      });

      const verified = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      assert.equal(verified.statusCode, 400, JSON.stringify(verified.body));
      assert.equal(verified.body.code, 'INVOICE_NOT_PENDING');

      const stored = await storage.getInvoiceById(invoice.id);
      assert.equal(stored?.status, 'CANCELLED');
      assert.equal(Boolean(stored?.paymentTxHash), false);
    });

    it('rejects cancellation after payment has already settled', async () => {
      const invoice = await createInvoice();
      const settledAt = new Date().toISOString();
      transaction = paymentTransaction({ memo: invoice.memo, createdAt: settledAt });

      const verified = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );
      assert.equal(verified.statusCode, 200, JSON.stringify(verified.body));

      const cancelled = await call(
        handlers().cancelInvoice,
        createReq({ params: { id: invoice.id }, body: { sellerPublicKey: SELLER } })
      );

      assert.equal(cancelled.statusCode, 400);
      const stored = await storage.getInvoiceById(invoice.id);
      assert.equal(stored?.status, 'PAID');
      assert.equal(stored?.paymentTxHash, TX_HASH);
    });

    it('settles a payment whose ledger close time passed expiresAt as AFTER_EXPIRY', async () => {
      const invoice = await createInvoice();
      const settledAt = isoOffset(invoice.expiresAt, 1000);
      transaction = paymentTransaction({ memo: invoice.memo, createdAt: settledAt });

      const verified = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      assert.equal(verified.statusCode, 200, JSON.stringify(verified.body));
      assert.equal(verified.body.code, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
      assert.equal(verified.body.warning, 'Payment was received after this invoice expired.');
      assert.equal(verified.body.data.status, 'PAID');
      assert.equal(verified.body.data.settlementContext, 'AFTER_EXPIRY');
      assert.equal(new Date(verified.body.data.settledAt).toISOString(), settledAt);
      assert.equal(verified.body.data.priorStatus, 'PENDING');
      assert.equal(verified.body.data.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
    });

    it('settles a payment on an already-EXPIRED invoice as AFTER_EXPIRY', async () => {
      const invoice = await createInvoice();
      await storage.markExpiredInvoices(new Date(isoOffset(invoice.expiresAt, 1000)));
      const settledAt = isoOffset(invoice.expiresAt, 1000);
      transaction = paymentTransaction({ memo: invoice.memo, createdAt: settledAt });

      const verified = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      assert.equal(verified.statusCode, 200, JSON.stringify(verified.body));
      assert.equal(verified.body.code, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
      assert.equal(verified.body.data.status, 'PAID');
      assert.equal(verified.body.data.settlementContext, 'AFTER_EXPIRY');
      assert.equal(verified.body.data.priorStatus, 'EXPIRED');
      assert.equal(verified.body.data.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
    });

    it('keeps a payment included before expiry ON_TIME when detected after the sweep', async () => {
      const invoice = await createInvoice();
      await storage.markExpiredInvoices(new Date(isoOffset(invoice.expiresAt, 1000)));
      const settledAt = isoOffset(invoice.expiresAt, -1000);
      transaction = paymentTransaction({ memo: invoice.memo, createdAt: settledAt });

      const verified = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      assert.equal(verified.statusCode, 200, JSON.stringify(verified.body));
      assert.equal(verified.body.code, undefined);
      assert.equal(verified.body.warning, undefined);
      assert.equal(verified.body.data.status, 'PAID');
      assert.equal(verified.body.data.settlementContext, 'ON_TIME');
      assert.equal(new Date(verified.body.data.settledAt).toISOString(), settledAt);
      assert.equal(verified.body.data.priorStatus, 'EXPIRED');
      assert.ok(!verified.body.data.latePaymentWarningCode);
    });

    it('refuses to settle when the transaction close time is missing', async () => {
      const invoice = await createInvoice();
      const tx = paymentTransaction({ memo: invoice.memo, createdAt: new Date().toISOString() });
      delete tx.transaction.created_at;
      transaction = tx;

      const verified = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      assert.equal(verified.statusCode, 503, JSON.stringify(verified.body));
      assert.equal(verified.body.code, 'TRANSACTION_CLOSE_TIME_UNAVAILABLE');

      const stored = await storage.getInvoiceById(invoice.id);
      assert.equal(stored?.status, 'PENDING');
      assert.equal(Boolean(stored?.paymentTxHash), false);
    });
  });
}

class MemoryCheckpointStore implements PaymentMonitorCheckpointStore {
  value: PaymentMonitorCheckpoint | null = {
    account: SELLER,
    network: 'TESTNET',
    cursor: 'cursor-0',
    updatedAt: new Date(),
  };

  async load() {
    return this.value;
  }

  async save(value: Omit<PaymentMonitorCheckpoint, 'updatedAt'>) {
    this.value = { ...value, updatedAt: new Date() };
  }
}

function monitorSource(
  memo: string,
  createdAt: string,
  overrides: { amount?: string } = {}
): PaymentPageSource {
  return {
    async getLatestPaymentCursor() {
      return 'cursor-0';
    },
    async getPaymentsPage() {
      return [
        {
          pagingToken: 'cursor-1',
          ledger: 123,
          payment: {
            id: 'payment-1',
            txHash: TX_HASH_2,
            from: PAYER,
            to: SELLER,
            amount: overrides.amount ?? '42.5000000',
            assetCode: 'XLM',
            memo,
            memoType: 'text',
            ledger: 123,
            createdAt,
          },
        },
      ];
    },
  };
}

interface MonitorTestHarness {
  invoices: InvoiceService | InvoiceMemoryService;
  database?: any;
  createInvoice: () => Promise<{ id: string; memo: string }>;
  cancelInvoice: (id: string) => Promise<{ cancelledAt: string | Date }>;
  getInvoice: (id: string) => Promise<{ status: string; paymentTxHash?: string | null } | null | undefined>;
  getPaymentEvents: (id: string) => Promise<Array<{ eventType: string; eventData: any }>>;
}

function createMemoryMonitorHarness(): MonitorTestHarness {
  const rawStorage = new MemoryStorage();
  const invoiceService = new InvoiceMemoryService(rawStorage);
  return {
    invoices: invoiceService,
    database: undefined,
    createInvoice: async () => {
      const inv = await invoiceService.createInvoice({
        sellerPublicKey: SELLER,
        amount: 42.5,
        assetCode: 'XLM',
      });
      return { id: inv.id, memo: inv.memo };
    },
    cancelInvoice: async (id: string) => {
      const cancelled = rawStorage.cancelInvoice(id, SELLER);
      return { cancelledAt: cancelled!.cancelledAt! };
    },
    getInvoice: async (id: string) => rawStorage.getInvoiceById(id),
    getPaymentEvents: async (id: string) => invoiceService.getPaymentEvents(id),
  };
}

function createPostgresMonitorHarness(): MonitorTestHarness {
  const db = new FakePostgresDb();
  const invoiceService = new InvoiceService(db as any);
  return {
    invoices: invoiceService,
    database: db as any,
    createInvoice: async () => {
      const inv = await invoiceService.createInvoice({
        sellerPublicKey: SELLER,
        amount: 42.5,
        assetCode: 'XLM',
      });
      return { id: inv.id, memo: inv.memo };
    },
    cancelInvoice: async (id: string) => {
      const cancelled = await invoiceService.cancelInvoice(id, SELLER);
      return { cancelledAt: cancelled!.cancelledAt! };
    },
    getInvoice: async (id: string) => invoiceService.getInvoiceById(id),
    getPaymentEvents: async (id: string) => invoiceService.getPaymentEvents(id),
  };
}

function runMonitorCancelSuite(name: string, createHarness: () => MonitorTestHarness) {
  describe(`cancel versus payment monitor attribution on ${name}`, () => {
    let harness: MonitorTestHarness;

    beforeEach(() => {
      harness = createHarness();
    });

    it('rejects an exact payment found after cancellation and logs PAYMENT_REJECTED', async () => {
      const invoice = await harness.createInvoice();
      const cancelled = await harness.cancelInvoice(invoice.id);
      assert.ok(cancelled?.cancelledAt, 'cancellation must record cancelledAt');
      const settledAt = isoOffset(cancelled.cancelledAt, 1000);

      const monitor = new PaymentMonitorService({
        account: SELLER,
        network: 'TESTNET',
        source: monitorSource(invoice.memo, settledAt),
        invoices: harness.invoices,
        checkpoints: new MemoryCheckpointStore(),
        database: harness.database,
      });

      await monitor.runOnce();

      const stored = await harness.getInvoice(invoice.id);
      assert.equal(stored?.status, 'CANCELLED');
      assert.equal(Boolean(stored?.paymentTxHash), false);

      const events = await harness.getPaymentEvents(invoice.id);
      assert.equal(events.length, 1);
      assert.equal(events[0].eventType, 'PAYMENT_REJECTED');
      assert.equal(events[0].eventData.code, 'INVOICE_NOT_PENDING');
    });

    it('logs a mismatch after cancellation without changing the cancelled invoice', async () => {
      const invoice = await harness.createInvoice();
      const cancelled = await harness.cancelInvoice(invoice.id);
      assert.ok(cancelled?.cancelledAt, 'cancellation must record cancelledAt');

      const monitor = new PaymentMonitorService({
        account: SELLER,
        network: 'TESTNET',
        source: monitorSource(invoice.memo, isoOffset(cancelled.cancelledAt, 1000), { amount: '41.0000000' }),
        invoices: harness.invoices,
        checkpoints: new MemoryCheckpointStore(),
        database: harness.database,
      });

      await monitor.runOnce();

      const stored = await harness.getInvoice(invoice.id);
      assert.equal(stored?.status, 'CANCELLED');
      assert.equal(Boolean(stored?.paymentTxHash), false);

      const events = await harness.getPaymentEvents(invoice.id);
      assert.equal(events.length, 1);
      assert.equal(events[0].eventType, 'PAYMENT_REJECTED');
      assert.equal(events[0].eventData.code, 'INVOICE_NOT_PENDING');
    });
  });
}

runMonitorCancelSuite('in-memory storage', createMemoryMonitorHarness);
runMonitorCancelSuite('postgres storage double', createPostgresMonitorHarness);

runManualVerifySuite('in-memory storage', createMemoryStorage);
runManualVerifySuite('postgres storage double', createPostgresStorage);

// Issue #501: one transaction hash settles at most one invoice. The in-memory
// engine enforces it through PaymentClaimIndex; the Postgres engine through the
// partial unique index on payment_tx_hash, mapped to the same typed rejection.
function runClaimLockSuite(name: string, createStorage: () => InvoiceStorage) {
  describe(`one transaction settles one invoice on ${name}`, () => {
    let storage: InvoiceStorage;

    const createInvoice = () =>
      storage.createInvoice({
        sellerPublicKey: SELLER,
        amount: 42.5,
        assetCode: 'XLM',
        description: 'Claim-lock race',
      });

    beforeEach(() => {
      storage = createStorage();
    });

    it('rejects a second invoice claiming an already-settled transaction', async () => {
      const first = await createInvoice();
      const second = await createInvoice();
      assert.notEqual(first.memo, second.memo);
      const settledAt = new Date();

      const settled = await storage.markAsPaid(first.id, TX_HASH, PAYER, undefined, {
        settledAt,
      });
      assert.equal(settled.status, 'PAID');
      assert.equal(settled.paymentTxHash, TX_HASH);

      const rejection = await storage
        .markAsPaid(second.id, TX_HASH, PAYER, undefined, { settledAt: new Date() })
        .then(
          () => null,
          (error: unknown) => error
        );
      assert.ok(rejection instanceof PaymentClaimError, `expected PaymentClaimError, got ${rejection}`);
      assert.equal(rejection.code, 'TX_HASH_ALREADY_USED');
      assert.equal(rejection.txHash, TX_HASH);
      assert.equal(rejection.settledInvoiceId, first.id);

      const stored = await storage.getInvoiceById(second.id);
      assert.equal(stored.status, 'PENDING');
      assert.equal(stored.paymentTxHash ?? null, null);
    });

    it('lets two invoices settle two distinct transactions', async () => {
      const first = await createInvoice();
      const second = await createInvoice();
      const settledAt = new Date();

      await storage.markAsPaid(first.id, TX_HASH, PAYER, undefined, { settledAt });
      const other = await storage.markAsPaid(second.id, TX_HASH_2, PAYER, undefined, {
        settledAt: new Date(),
      });
      assert.equal(other.status, 'PAID');
      assert.equal(other.paymentTxHash, TX_HASH_2);
    });
  });
}

runClaimLockSuite('in-memory storage', createMemoryStorage);
runClaimLockSuite('postgres storage double', createPostgresStorage);
