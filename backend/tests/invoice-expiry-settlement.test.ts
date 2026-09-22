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
import { SettlementTimeUnavailableError } from '../src/domain/invoice-settlement.ts';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage.ts';
import { MemoryStorage } from '../src/storage/memory-storage.ts';
import { PostgresInvoiceStorage } from '../src/storage/postgres-invoice-storage.ts';
import type { InvoiceStorage } from '../src/storage/invoice-storage.ts';

const SELLER = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const PAYER = 'GCBIBQVH2B3STCBIYSMTQH6DWKSB2XUGLXH7RGPIN3OXPCFCIQEICVZ6';
const TX_HASH = 'd'.repeat(64);
const TX_HASH_2 = 'e'.repeat(64);

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
    sellerPublicKey: SELLER,
    amount: 42.5,
    assetCode: 'XLM',
    description: 'Expiry settlement fixture',
    expiresInDays: 1,
    ...overrides,
  };
}

function isoOffset(baseIso: string | Date, deltaMs: number): string {
  return new Date(new Date(baseIso).getTime() + deltaMs).toISOString();
}

function paymentTransaction(overrides: {
  memo: string;
  amount?: string;
  createdAt?: string;
}) {
  return {
    transaction: {
      memo: overrides.memo,
      created_at: overrides.createdAt,
    },
    operations: [
      {
        type: 'payment',
        from: PAYER,
        to: SELLER,
        amount: overrides.amount ?? '42.5000000',
        asset_type: 'native',
      },
    ],
  };
}

class FakePostgresDb implements Queryable {
  rows: any[] = [];
  events: any[] = [];

  async query(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.startsWith('INSERT INTO invoices')) {
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

    if (normalized.startsWith("UPDATE invoices SET status = 'EXPIRED'")) {
      const now = new Date(params[0]).getTime();
      const expired = this.rows.filter(
        (row) => row.status === 'PENDING' && new Date(row.expires_at).getTime() <= now
      );
      expired.forEach((row) => {
        row.status = 'EXPIRED';
      });
      return { rows: expired.map((row) => ({ id: row.id })), rowCount: expired.length };
    }

    if (normalized.startsWith("UPDATE invoices SET status = 'PAID'") || normalized.startsWith('WITH settled AS')) {
      const row = this.rows.find((candidate) => candidate.id === params[0]);
      const rawSettledAt = params[5];
      const hasSettledAt = rawSettledAt !== undefined && rawSettledAt !== null;
      const settledAt = hasSettledAt ? new Date(rawSettledAt) : new Date();
      const validSettledAt = Number.isFinite(settledAt.getTime());
      const canSettle =
        row &&
        (
          (row.status === 'PENDING' && new Date(row.expires_at).getTime() > Date.now()) ||
          (row.status === 'PENDING' && hasSettledAt && validSettledAt) ||
          (row.status === 'EXPIRED' && hasSettledAt && validSettledAt) ||
          (row.status === 'CANCELLED' && row.cancelled_at && hasSettledAt && validSettledAt)
        );

      if (!row || !canSettle) {
        return { rows: [], rowCount: 0 };
      }

      const priorStatus = row.status;
      const afterCancel =
        priorStatus === 'CANCELLED' &&
        settledAt.getTime() >= new Date(row.cancelled_at).getTime();
      const afterExpiry =
        priorStatus !== 'CANCELLED' &&
        hasSettledAt &&
        settledAt.getTime() >= new Date(row.expires_at).getTime();

      Object.assign(row, {
        status: 'PAID',
        payment_tx_hash: params[1],
        payer_public_key: params[2],
        payer_name: params[3],
        payer_email: params[4],
        paid_at: new Date(),
        settled_at: settledAt,
        settlement_context: afterCancel
          ? 'AFTER_CANCEL'
          : afterExpiry
            ? 'AFTER_EXPIRY'
            : 'ON_TIME',
        prior_status: priorStatus === 'CANCELLED'
          ? 'CANCELLED'
          : priorStatus === 'EXPIRED'
            ? 'EXPIRED'
            : null,
        late_payment_warning_code: afterCancel
          ? 'PAYMENT_RECEIVED_AFTER_CANCEL'
          : afterExpiry
            ? 'PAYMENT_RECEIVED_AFTER_EXPIRY'
            : null,
      });

      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (normalized.startsWith('INSERT INTO payment_events')) {
      this.events.push({ invoiceId: params[0], type: params[1], data: params[2] });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('SELECT * FROM invoices WHERE id =')) {
      const found = this.rows.filter((row) => row.id === params[0]);
      return { rows: found.map((row) => ({ ...row })), rowCount: found.length };
    }

    if (normalized.startsWith('SELECT * FROM invoices WHERE memo =')) {
      const found = this.rows.filter((row) => row.memo === params[0]);
      return { rows: found.map((row) => ({ ...row })), rowCount: found.length };
    }

    throw new Error(`Unhandled query in fake Postgres: ${sql}`);
  }
}

function runExpiryAttributionSuite(name: string, createStorage: () => InvoiceStorage) {
  describe(`expiry settlement classification on ${name}`, () => {
    let storage: InvoiceStorage;
    let transaction: any;

    const handlers = () =>
      createInvoiceHandlers({
        storage,
        frontendUrl: 'http://localhost:3000',
        allowSimulate: false,
        stellar: {
          getTransaction: async () => transaction,
        } as any,
      });

    const createInvoice = async () => {
      const res = await call(handlers().createInvoice, createReq({ body: invoiceBody() }));
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      return res.body.data.invoice;
    };

    beforeEach(() => {
      storage = createStorage();
      transaction = undefined;
    });

    it('settles a payment whose close_time is after expiresAt as AFTER_EXPIRY', async () => {
      const invoice = await createInvoice();
      const settledAt = isoOffset(invoice.expiresAt, 5000);
      transaction = paymentTransaction({ memo: invoice.memo, createdAt: settledAt });

      const verified = await call(
        handlers().verifyPayment,
        createReq({ params: { id: invoice.id }, body: { txHash: TX_HASH } })
      );

      assert.equal(verified.statusCode, 200, JSON.stringify(verified.body));
      assert.equal(verified.body.success, true);
      assert.equal(verified.body.code, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
      assert.equal(verified.body.warning, 'Payment was received after this invoice expired.');
      assert.equal(verified.body.data.status, 'PAID');
      assert.equal(verified.body.data.paymentTxHash, TX_HASH);
      assert.equal(verified.body.data.settlementContext, 'AFTER_EXPIRY');
      assert.equal(new Date(verified.body.data.settledAt).toISOString(), settledAt);
      assert.equal(verified.body.data.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
    });

    it('settles a payment whose close_time is before expiresAt as ON_TIME even under clock skew', async () => {
      const invoice = await createInvoice();
      const settledAt = isoOffset(invoice.expiresAt, -5000);
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
      assert.equal(Boolean(verified.body.data.latePaymentWarningCode), false);
    });

    it('fails closed with 503 when Horizon transaction close_time is missing', async () => {
      const invoice = await createInvoice();
      transaction = paymentTransaction({ memo: invoice.memo, createdAt: undefined });

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

runExpiryAttributionSuite('in-memory storage', () =>
  new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage()))
);

runExpiryAttributionSuite('postgres storage double', () =>
  new PostgresInvoiceStorage(new InvoiceService(new FakePostgresDb()))
);

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

function monitorSource(createdAt: string | undefined): PaymentPageSource {
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
            amount: '42.5000000',
            assetCode: 'XLM',
            memo: 'INV-EXPIRY-MONITOR',
            memoType: 'text',
            ledger: 123,
            createdAt,
          },
        },
      ];
    },
  };
}

describe('payment monitor expiry settlement attribution', () => {
  let rawStorage: MemoryStorage;
  let invoiceService: InvoiceMemoryService;

  beforeEach(() => {
    rawStorage = new MemoryStorage();
    invoiceService = new InvoiceMemoryService(rawStorage);
  });

  it('marks invoice PAID with AFTER_EXPIRY when monitor detects payment after expiresAt', async () => {
    const created = rawStorage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 42.5,
      memo: 'INV-EXPIRY-MONITOR',
      expiresAt: new Date(Date.now() - 10000),
    });

    const settledAt = new Date(Date.now() - 5000).toISOString();
    const monitor = new PaymentMonitorService({
      account: SELLER,
      network: 'TESTNET',
      source: monitorSource(settledAt),
      invoices: invoiceService,
      checkpoints: new MemoryCheckpointStore(),
      database: undefined,
    });

    await monitor.runOnce();

    const stored = rawStorage.getInvoiceById(created.id);
    assert.equal(stored?.status, 'PAID');
    assert.equal(stored?.paymentTxHash, TX_HASH_2);
    assert.equal(stored?.settlementContext, 'AFTER_EXPIRY');
    assert.equal(stored?.latePaymentWarningCode, 'PAYMENT_RECEIVED_AFTER_EXPIRY');
  });

  it('does not mark PAID when monitor encounters payment with missing close_time', async () => {
    const created = rawStorage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 42.5,
      memo: 'INV-EXPIRY-MONITOR',
      expiresAt: new Date(Date.now() - 10000),
    });

    const monitor = new PaymentMonitorService({
      account: SELLER,
      network: 'TESTNET',
      source: monitorSource(undefined),
      invoices: invoiceService,
      checkpoints: new MemoryCheckpointStore(),
      database: undefined,
    });

    await assert.rejects(
      async () => {
        await monitor.runOnce();
      },
      (error: any) => error.name === 'SettlementTimeUnavailableError'
    );

    const stored = rawStorage.getInvoiceById(created.id);
    assert.notEqual(stored?.status, 'PAID');
    assert.equal(Boolean(stored?.paymentTxHash), false);
  });
});
