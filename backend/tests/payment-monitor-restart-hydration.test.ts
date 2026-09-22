import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PaymentMonitorService, PaymentPageSource } from '../src/services/payment-monitor.service';
import type {
  PaymentMonitorCheckpoint,
  PaymentMonitorCheckpointStore,
} from '../src/services/payment-monitor-checkpoint';
import { MemoryStorage } from '../src/storage/memory-storage';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { InvoiceService } from '../src/services/invoice.service';

const SELLER_A = 'GSELLERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SELLER_B = 'GSELLERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const PAYER = 'GPAYERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TX_HASH_1 = '1'.repeat(64);
const TX_HASH_2 = '2'.repeat(64);

class TestCheckpointStore implements PaymentMonitorCheckpointStore {
  value: PaymentMonitorCheckpoint | null;

  constructor(cursor?: string) {
    this.value = cursor
      ? { account: SELLER_A, network: 'TESTNET', cursor, updatedAt: new Date() }
      : null;
  }

  async load() {
    return this.value;
  }

  async save(value: Omit<PaymentMonitorCheckpoint, 'updatedAt'>) {
    this.value = { ...value, updatedAt: new Date() };
  }
}

function createTestSource(pages: any[] = []): PaymentPageSource {
  let pageIndex = 0;
  return {
    async getPaymentsPage(_account: string, _cursor: string, _limit: number) {
      if (pageIndex >= pages.length) return [];
      const current = pages[pageIndex];
      pageIndex += 1;
      return current;
    },
    async getLatestPaymentCursor(_account: string) {
      return '100';
    },
  };
}

describe('PaymentMonitorService restart watch hydration', () => {
  it('hydrates PENDING unexpired invoices from memory storage on start', async () => {
    const memory = new MemoryStorage();
    const service = new InvoiceMemoryService(memory);

    const active1 = memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 10,
      assetCode: 'XLM',
      memo: 'MEMO-ACTIVE-1',
      expiresInDays: 1,
    });
    const active2 = memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 20,
      assetCode: 'XLM',
      memo: 'MEMO-ACTIVE-2',
      expiresInDays: 1,
    });
    const expired = memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 30,
      assetCode: 'XLM',
      memo: 'MEMO-EXPIRED',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const paid = memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 40,
      assetCode: 'XLM',
      memo: 'MEMO-PAID',
      expiresInDays: 1,
    });
    memory.markAsPaid(paid.id, TX_HASH_1, PAYER);

    const monitor = new PaymentMonitorService({
      account: SELLER_A,
      network: 'TESTNET',
      invoices: service,
      checkpoints: new TestCheckpointStore('50'),
      source: createTestSource(),
      database: undefined,
    });

    try {
      assert.equal(monitor.getWatchedCount(), 0);
      await monitor.start();

      assert.equal(monitor.getWatchedCount(), 2);
      assert.equal(monitor.isWatching(active1.id), true);
      assert.equal(monitor.isWatching(active2.id), true);
      assert.equal(monitor.isWatching(expired.id), false);
      assert.equal(monitor.isWatching(paid.id), false);
    } finally {
      monitor.stop();
    }
  });

  it('bounds hydration count to configured limit', async () => {
    const memory = new MemoryStorage();
    const service = new InvoiceMemoryService(memory);

    for (let i = 1; i <= 10; i += 1) {
      memory.createInvoice({
        sellerPublicKey: SELLER_A,
        amount: i * 5,
        assetCode: 'XLM',
        memo: `MEMO-BOUNDED-${i}`,
        expiresInDays: 1,
      });
    }

    const monitor = new PaymentMonitorService({
      account: SELLER_A,
      network: 'TESTNET',
      invoices: service,
      checkpoints: new TestCheckpointStore('50'),
      source: createTestSource(),
      hydrateLimit: 4,
      database: undefined,
    });

    try {
      await monitor.start();
      assert.equal(monitor.getWatchedCount(), 4);
    } finally {
      monitor.stop();
    }
  });

  it('scopes hydration to configured seller account', async () => {
    const memory = new MemoryStorage();
    const service = new InvoiceMemoryService(memory);

    const invA = memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 15,
      assetCode: 'XLM',
      memo: 'MEMO-SELLER-A',
      expiresInDays: 1,
    });
    const invB = memory.createInvoice({
      sellerPublicKey: SELLER_B,
      amount: 25,
      assetCode: 'XLM',
      memo: 'MEMO-SELLER-B',
      expiresInDays: 1,
    });

    const monitorA = new PaymentMonitorService({
      account: SELLER_A,
      network: 'TESTNET',
      invoices: service,
      checkpoints: new TestCheckpointStore('50'),
      source: createTestSource(),
      database: undefined,
    });

    try {
      await monitorA.start();
      assert.equal(monitorA.getWatchedCount(), 1);
      assert.equal(monitorA.isWatching(invA.id), true);
      assert.equal(monitorA.isWatching(invB.id), false);
    } finally {
      monitorA.stop();
    }

    const pendingAll = memory.getPendingInvoices(undefined, 100);
    assert.equal(pendingAll.length, 2);
  });

  it('settles existing pending invoice after monitor restart without new create event', async () => {
    const memory = new MemoryStorage();
    const service = new InvoiceMemoryService(memory);
    const checkpoints = new TestCheckpointStore('100');

    const pendingInvoice = memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 50,
      assetCode: 'XLM',
      memo: 'MEMO-RESTART-1',
      expiresInDays: 1,
    });

    const monitor1 = new PaymentMonitorService({
      account: SELLER_A,
      network: 'TESTNET',
      invoices: service,
      checkpoints,
      source: createTestSource(),
      database: undefined,
    });

    try {
      await monitor1.start();
      assert.equal(monitor1.isWatching(pendingInvoice.id), true);
    } finally {
      monitor1.stop();
    }

    const paymentPage = [
      {
        pagingToken: '101',
        ledger: 500,
        payment: {
          id: '101',
          txHash: TX_HASH_2,
          from: PAYER,
          to: SELLER_A,
          amount: '50.0000000',
          assetCode: 'XLM',
          memo: 'MEMO-RESTART-1',
          memoType: 'text',
          ledger: 500,
          createdAt: '2026-09-22T00:00:00Z',
        },
      },
    ];

    const source2 = createTestSource([paymentPage]);
    const monitor2 = new PaymentMonitorService({
      account: SELLER_A,
      network: 'TESTNET',
      invoices: service,
      checkpoints,
      source: source2,
      database: undefined,
    });

    try {
      await monitor2.start();
      assert.equal(monitor2.isWatching(pendingInvoice.id), true);

      const result = await monitor2.runOnce();
      assert.equal(result.processed, 1);
      assert.equal(result.cursor, '101');

      const settled = memory.getInvoiceById(pendingInvoice.id);
      assert.equal(settled?.status, 'PAID');
      assert.equal(settled?.paymentTxHash, TX_HASH_2);
      assert.equal(monitor2.isWatching(pendingInvoice.id), false);
      assert.equal(monitor2.getWatchedCount(), 0);

      const replayResult = await monitor2.runOnce();
      assert.equal(replayResult.processed, 0);
      const settledAgain = memory.getInvoiceById(pendingInvoice.id);
      assert.equal(settledAgain?.status, 'PAID');
    } finally {
      monitor2.stop();
    }
  });

  it('prevents same payment transaction from settling two different invoices', async () => {
    const memory = new MemoryStorage();
    const service = new InvoiceMemoryService(memory);
    const checkpoints = new TestCheckpointStore('200');

    const inv1 = memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 10,
      assetCode: 'XLM',
      memo: 'MEMO-SHARED-1',
      expiresInDays: 1,
    });
    const inv2 = memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 10,
      assetCode: 'XLM',
      memo: 'MEMO-SHARED-2',
      expiresInDays: 1,
    });

    const paymentPage = [
      {
        pagingToken: '201',
        ledger: 600,
        payment: {
          id: '201',
          txHash: TX_HASH_1,
          from: PAYER,
          to: SELLER_A,
          amount: '10.0000000',
          assetCode: 'XLM',
          memo: 'MEMO-SHARED-1',
          memoType: 'text',
          ledger: 600,
          createdAt: '2026-09-22T00:00:00Z',
        },
      },
      {
        pagingToken: '202',
        ledger: 601,
        payment: {
          id: '202',
          txHash: TX_HASH_1,
          from: PAYER,
          to: SELLER_A,
          amount: '10.0000000',
          assetCode: 'XLM',
          memo: 'MEMO-SHARED-2',
          memoType: 'text',
          ledger: 601,
          createdAt: '2026-09-22T00:00:00Z',
        },
      },
    ];

    const monitor = new PaymentMonitorService({
      account: SELLER_A,
      network: 'TESTNET',
      invoices: service,
      checkpoints,
      source: createTestSource([paymentPage]),
      database: undefined,
    });

    try {
      await monitor.start();
      assert.equal(monitor.getWatchedCount(), 2);

      await monitor.runOnce();

      const stored1 = memory.getInvoiceById(inv1.id);
      const stored2 = memory.getInvoiceById(inv2.id);

      assert.equal(stored1?.status, 'PAID');
      assert.equal(stored2?.status, 'PENDING');
      assert.equal(monitor.isWatching(inv1.id), false);
      assert.equal(monitor.isWatching(inv2.id), true);
    } finally {
      monitor.stop();
    }
  });

  it('executes correct SQL query for Postgres InvoiceService getPendingInvoices', async () => {
    const executedQueries: Array<{ text: string; params?: any[] }> = [];
    const mockDb = {
      async query(text: string, params?: any[]) {
        executedQueries.push({ text, params });
        return {
          rows: [
            {
              id: 'inv-pg-1',
              seller_public_key: SELLER_A,
              amount: '35.0000000',
              asset_code: 'XLM',
              memo: 'MEMO-PG-1',
              status: 'PENDING',
              created_at: new Date('2026-09-22T01:00:00Z'),
              expires_at: new Date('2026-09-23T01:00:00Z'),
            },
          ],
          rowCount: 1,
        };
      },
    };

    const pgService = new InvoiceService(mockDb as any);
    const results = await pgService.getPendingInvoices(SELLER_A, 100);

    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'inv-pg-1');
    assert.equal(results[0].amount, 35);
    assert.equal(results[0].memo, 'MEMO-PG-1');

    const selectQuery = executedQueries.find((q) => q.text.includes('SELECT * FROM invoices'));
    assert.ok(selectQuery);
    assert.ok(selectQuery.text.includes("status = 'PENDING'"));
    assert.ok(selectQuery.text.includes('expires_at > NOW()'));
    assert.ok(selectQuery.text.includes('seller_public_key = $1'));
    assert.ok(selectQuery.text.includes('LIMIT $2'));
    assert.deepEqual(selectQuery.params, [SELLER_A, 100]);
  });
});
