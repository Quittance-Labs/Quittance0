import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers.ts';
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

    if (sql.startsWith("UPDATE invoices SET status = 'PAID'") || sql.startsWith('WITH settled AS')) {
      const row = this.rows.find((candidate) => candidate.id === params[0]);
      const settledAt = params[5] ? new Date(params[5]) : (row?.status === 'PENDING' ? new Date() : null);
      const canSettle =
        row &&
        (
          (row.status === 'PENDING' && new Date(row.expires_at).getTime() > Date.now()) ||
          (row.status === 'CANCELLED' && row.cancelled_at && settledAt && Number.isFinite(settledAt.getTime()))
        );

      if (!row || !canSettle || !settledAt) {
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

    it('turns a matching payment detected after seller cancellation into PAID AFTER_CANCEL', async () => {
      const invoice = await createInvoice();
      const cancelled = await cancelInvoice(invoice.id);
      const settledAt = isoOffset(cancelled.cancelledAt, 1000);
      transaction = paymentTransaction({ memo: invoice.memo, createdAt: settledAt });

      const verified = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      assert.equal(verified.statusCode, 200, JSON.stringify(verified.body));
      assert.equal(verified.body.success, true);
      assert.equal(verified.body.code, 'PAYMENT_RECEIVED_AFTER_CANCEL');
      assert.equal(verified.body.warning, 'Payment was received after this invoice was cancelled.');
      assert.equal(verified.body.data.status, 'PAID');
      assert.equal(verified.body.data.paymentTxHash, TX_HASH);
      assert.equal(verified.body.data.settlementContext, 'AFTER_CANCEL');
      assert.equal(new Date(verified.body.data.settledAt).toISOString(), settledAt);
      assert.equal(verified.body.data.priorStatus, 'CANCELLED');
      assert.equal(verified.body.data.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_CANCEL');
    });

    it('classifies a payment already on-chain before cancellation as ON_TIME when detected later', async () => {
      const invoice = await createInvoice();
      const cancelled = await cancelInvoice(invoice.id);
      const settledAt = isoOffset(cancelled.cancelledAt, -1000);
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
      assert.equal(verified.body.data.priorStatus, 'CANCELLED');
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
      assert.equal(verified.body.code, 'AMOUNT_TOO_LOW');

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
      assert.equal(cancelled.body.code, 'INVOICE_ALREADY_PAID');
      const stored = await storage.getInvoiceById(invoice.id);
      assert.equal(stored?.status, 'PAID');
      assert.equal(stored?.paymentTxHash, TX_HASH);
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

function monitorSource(createdAt: string, overrides: { amount?: string } = {}): PaymentPageSource {
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
            memo: 'INV-MONITOR-CANCEL',
            memoType: 'text',
            ledger: 123,
            createdAt,
          },
        },
      ];
    },
  };
}

describe('cancel versus payment monitor attribution on memory storage', () => {
  let rawStorage: MemoryStorage;
  let invoiceService: InvoiceMemoryService;

  beforeEach(() => {
    rawStorage = new MemoryStorage();
    invoiceService = new InvoiceMemoryService(rawStorage);
  });

  it('settles an exact payment found after cancellation with AFTER_CANCEL context', async () => {
    const invoice = rawStorage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 42.5,
      assetCode: 'XLM',
      memo: 'INV-MONITOR-CANCEL',
    });
    const cancelled = rawStorage.cancelInvoice(invoice.id, SELLER);
    assert.ok(cancelled?.cancelledAt, 'cancellation must record cancelledAt');
    const settledAt = isoOffset(cancelled.cancelledAt, 1000);

    const monitor = new PaymentMonitorService({
      account: SELLER,
      network: 'TESTNET',
      source: monitorSource(settledAt),
      invoices: invoiceService,
      checkpoints: new MemoryCheckpointStore(),
      database: undefined,
    });

    await monitor.runOnce();

    const stored = rawStorage.getInvoiceById(invoice.id);
    assert.equal(stored?.status, 'PAID');
    assert.equal(stored?.paymentTxHash, TX_HASH_2);
    assert.equal(stored?.settlementContext, 'AFTER_CANCEL');
    assert.equal(stored?.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_CANCEL');
  });

  it('logs a mismatch after cancellation without changing the cancelled invoice', async () => {
    const invoice = rawStorage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 42.5,
      assetCode: 'XLM',
      memo: 'INV-MONITOR-CANCEL',
    });
    const cancelled = rawStorage.cancelInvoice(invoice.id, SELLER);
    assert.ok(cancelled?.cancelledAt, 'cancellation must record cancelledAt');

    const monitor = new PaymentMonitorService({
      account: SELLER,
      network: 'TESTNET',
      source: monitorSource(isoOffset(cancelled.cancelledAt, 1000), { amount: '41.0000000' }),
      invoices: invoiceService,
      checkpoints: new MemoryCheckpointStore(),
      database: undefined,
    });

    await monitor.runOnce();

    const stored = rawStorage.getInvoiceById(invoice.id);
    assert.equal(stored?.status, 'CANCELLED');
    assert.equal(stored?.paymentTxHash, undefined);

    const events = await invoiceService.getPaymentEvents(invoice.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'PARTIAL_PAYMENT');
    assert.equal(events[0].eventData.code, 'AMOUNT_TOO_LOW');
  });
});

runManualVerifySuite('in-memory storage', createMemoryStorage);
runManualVerifySuite('postgres storage double', createPostgresStorage);
