import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PaymentMonitorService,
  PaymentPageSource,
} from '../src/services/payment-monitor.service';
import type {
  PaymentMonitorCheckpoint,
  PaymentMonitorCheckpointStore,
} from '../src/services/payment-monitor-checkpoint';
import type { StoredInvoice } from '../src/storage/invoice-storage';
import { withPaymentTransactions } from './fixtures/payment-page-source';

const SELLER_KEY = 'GAA5INZB2GO3FJN4VXJYJSSIQXN4EKQTZWTR6R566TR3IMTXHSUDORLI';
const OTHER_SELLER = 'GBZXN7PIRZGNMHGA72UDEL52OQK6ICNJPF37ACNO42P7J7W4TX225656';
const PAYER_KEY = 'GCFXHS4GXL6BVUCXBWXGTIT5OIFGNQJ54OVHQ3XQ7DBBQMQXBPDMG5XN';
const TX_HASH = '3'.repeat(64);

class TestCheckpointStore implements PaymentMonitorCheckpointStore {
  value: PaymentMonitorCheckpoint | null;
  constructor(initialCursor?: string) {
    this.value = initialCursor
      ? { account: SELLER_KEY, network: 'TESTNET', cursor: initialCursor, updatedAt: new Date() }
      : null;
  }
  async load() {
    return this.value;
  }
  async save(value: Omit<PaymentMonitorCheckpoint, 'updatedAt'>) {
    this.value = { ...value, updatedAt: new Date() };
  }
}

function createMockInvoice(
  id: string,
  memo: string,
  amount = 10,
  seller = SELLER_KEY
): StoredInvoice {
  return {
    id,
    sellerPublicKey: seller,
    amount,
    assetCode: 'XLM',
    memo,
    status: 'PENDING',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
  };
}

/** A MonitorInvoiceService stand-in backed by a mutable pending list — the
 * same shape both storage engines expose through listPendingInvoices. */
function createInvoiceStore(initial: StoredInvoice[]) {
  const byMemo = new Map(initial.map((inv) => [inv.memo, inv]));
  const events: Array<{ invoiceId: string; type: string; data: any }> = [];
  return {
    events,
    async getInvoiceByMemo(memo: string) {
      return byMemo.get(memo) || null;
    },
    async markAsPaid(id: string, hash: string, payer: string) {
      const inv = [...byMemo.values()].find((i) => i.id === id)!;
      inv.status = 'PAID';
      inv.paymentTxHash = hash;
      inv.payerPublicKey = payer;
      return inv;
    },
    async markExpiredInvoices() {
      return 0;
    },
    async logPaymentEvent(invoiceId: string, type: string, data: any) {
      events.push({ invoiceId, type, data });
    },
    async listPendingInvoices(sellerPublicKey: string | undefined, limit: number) {
      return [...byMemo.values()]
        .filter(
          (inv) =>
            inv.status === 'PENDING' &&
            (!sellerPublicKey || inv.sellerPublicKey === sellerPublicKey)
        )
        .slice(0, limit);
    },
  };
}

const EMPTY_SOURCE: PaymentPageSource = withPaymentTransactions({
  async getLatestPaymentCursor() {
    return '100';
  },
  async getPaymentsPage() {
    return [];
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Payment monitor restart hydration (issue #502)', () => {
  it('re-registers pending watches on start without a new create', async () => {
    const invA = createMockInvoice('inv-h1', 'MEMO-H1', 10);
    const invB = createMockInvoice('inv-h2', 'MEMO-H2', 20);
    const store = createInvoiceStore([invA, invB]);

    const monitor = new PaymentMonitorService({
      account: SELLER_KEY,
      source: EMPTY_SOURCE,
      invoices: store as any,
      checkpoints: new TestCheckpointStore('100'),
      pollIntervalMs: 60_000,
    });

    assert.equal(monitor.getWatchedCount(), 0);
    monitor.start();
    try {
      // Hydration is async but ordered before the first poll.
      for (let i = 0; i < 50 && monitor.getWatchedCount() < 2; i += 1) {
        await sleep(10);
      }
      assert.equal(monitor.getWatchedCount(), 2);
      assert.equal(monitor.isWatching('inv-h1'), true);
      assert.equal(monitor.isWatching('inv-h2'), true);
    } finally {
      monitor.stop();
    }
  });

  it('scopes hydration to the monitor account when a seller is configured', async () => {
    const own = createMockInvoice('inv-own', 'MEMO-OWN', 10, SELLER_KEY);
    const foreign = createMockInvoice('inv-other', 'MEMO-OTHER', 10, OTHER_SELLER);
    const store = createInvoiceStore([own, foreign]);

    const monitor = new PaymentMonitorService({
      account: SELLER_KEY,
      source: EMPTY_SOURCE,
      invoices: store as any,
      checkpoints: new TestCheckpointStore('100'),
      pollIntervalMs: 60_000,
    });

    monitor.start();
    try {
      for (let i = 0; i < 50 && monitor.getWatchedCount() < 1; i += 1) {
        await sleep(10);
      }
      assert.equal(monitor.getWatchedCount(), 1);
      assert.equal(monitor.isWatching('inv-own'), true);
      assert.equal(monitor.isWatching('inv-other'), false);
    } finally {
      monitor.stop();
    }
  });

  it('settles a payment that landed while the process was down, exactly once', async () => {
    const invoice = createMockInvoice('inv-restart', 'MEMO-RESTART', 42);
    const store = createInvoiceStore([invoice]);

    const source: PaymentPageSource = withPaymentTransactions({
      async getLatestPaymentCursor() {
        return '100';
      },
      async getPaymentsPage() {
        return [
          {
            pagingToken: '101',
            ledger: 500,
            payment: {
              id: '101',
              txHash: TX_HASH,
              from: PAYER_KEY,
              to: SELLER_KEY,
              amount: '42.0000000',
              assetCode: 'XLM',
              memo: 'MEMO-RESTART',
              memoType: 'text',
              ledger: 500,
              createdAt: '2026-09-20T00:00:00Z',
            },
          },
        ];
      },
    });

    const monitor = new PaymentMonitorService({
      account: SELLER_KEY,
      source,
      invoices: store as any,
      checkpoints: new TestCheckpointStore('100'),
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
      pollIntervalMs: 60_000,
    });

    // Simulated restart: no registerWatch call — start() hydrates the watch
    // from storage, then the first poll settles the matching payment once.
    monitor.start();
    try {
      for (let i = 0; i < 100 && invoice.status !== 'PAID'; i += 1) {
        await sleep(10);
      }
      assert.equal(invoice.status, 'PAID');
      assert.equal(invoice.paymentTxHash, TX_HASH);
      assert.equal(monitor.isWatching('inv-restart'), false);

      // A replayed page cannot settle the same invoice twice.
      await monitor.runOnce();
      assert.equal(invoice.status, 'PAID');
      assert.equal(invoice.paymentTxHash, TX_HASH);
      const paidEvents = store.events.filter(
        (e) => e.invoiceId === 'inv-restart'
      );
      assert.equal(
        paidEvents.filter((e) => e.type === 'PAYMENT_RECEIVED').length <= 1,
        true,
        'settlement must not double-fire'
      );
    } finally {
      monitor.stop();
    }
  });

  it('does not resurrect expired invoices as watches', async () => {
    const expired = createMockInvoice('inv-expired', 'MEMO-EXP', 10);
    expired.expiresAt = new Date(Date.now() - 60_000);
    const live = createMockInvoice('inv-live', 'MEMO-LIVE', 10);
    const store = createInvoiceStore([expired, live]);

    const monitor = new PaymentMonitorService({
      account: SELLER_KEY,
      source: EMPTY_SOURCE,
      invoices: store as any,
      checkpoints: new TestCheckpointStore('100'),
      pollIntervalMs: 60_000,
    });

    monitor.start();
    try {
      for (let i = 0; i < 50 && monitor.getWatchedCount() < 1; i += 1) {
        await sleep(10);
      }
      assert.equal(monitor.getWatchedCount(), 1);
      assert.equal(monitor.isWatching('inv-live'), true);
      assert.equal(monitor.isWatching('inv-expired'), false);
    } finally {
      monitor.stop();
    }
  });
});
