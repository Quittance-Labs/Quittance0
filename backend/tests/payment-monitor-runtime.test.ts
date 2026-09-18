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
import { PaymentClaimError } from '../src/domain/payment-attribution';

const SELLER_KEY = 'GAA5INZB2GO3FJN4VXJYJSSIQXN4EKQTZWTR6R566TR3IMTXHSUDORLI';
const PAYER_KEY = 'GBZXN7PIRZGNMHGA72UDEL52OQK6ICNJPF37ACNO42P7J7W4TX225656';
const TX_HASH_1 = '1'.repeat(64);
const TX_HASH_2 = '2'.repeat(64);

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

function createMockInvoice(id: string, memo: string, amount = 10, expiresAt?: Date): StoredInvoice {
  return {
    id,
    sellerPublicKey: SELLER_KEY,
    amount,
    assetCode: 'XLM',
    memo,
    status: 'PENDING',
    createdAt: new Date(),
    expiresAt: expiresAt || new Date(Date.now() + 3600_000),
  };
}

describe('PaymentMonitorService Runtime & Multi-Invoice Watch', () => {
  it('manages watch lifecycle: register, query, and unregister', () => {
    const monitor = new PaymentMonitorService({ account: SELLER_KEY });
    const inv1 = createMockInvoice('inv-1', 'MEMO-1', 10);
    const inv2 = createMockInvoice('inv-2', 'MEMO-2', 20);

    assert.equal(monitor.getWatchedCount(), 0);
    assert.equal(monitor.isWatching('inv-1'), false);

    monitor.registerWatch(inv1);
    monitor.registerWatch(inv2);

    assert.equal(monitor.getWatchedCount(), 2);
    assert.equal(monitor.isWatching('inv-1'), true);
    assert.equal(monitor.isWatching('inv-2'), true);

    const watchedList = monitor.getWatchedInvoices();
    assert.equal(watchedList.length, 2);
    assert.equal(watchedList.find((w) => w.id === 'inv-1')?.memo, 'MEMO-1');

    monitor.unregisterWatch('inv-1');
    assert.equal(monitor.getWatchedCount(), 1);
    assert.equal(monitor.isWatching('inv-1'), false);
    assert.equal(monitor.isWatching('inv-2'), true);
  });

  it('prunes expired watches whose expiresAt timestamp is in the past', () => {
    const monitor = new PaymentMonitorService({ account: SELLER_KEY });
    const past = new Date(Date.now() - 5000);
    const future = new Date(Date.now() + 60_000);

    monitor.registerWatch(createMockInvoice('inv-exp', 'MEMO-EXP', 10, past));
    monitor.registerWatch(createMockInvoice('inv-active', 'MEMO-ACTIVE', 20, future));

    assert.equal(monitor.getWatchedCount(), 2);
    const pruned = monitor.pruneExpiredWatches();
    assert.equal(pruned, 1);
    assert.equal(monitor.getWatchedCount(), 1);
    assert.equal(monitor.isWatching('inv-exp'), false);
    assert.equal(monitor.isWatching('inv-active'), true);
  });

  it('settles only the matching invoice among multiple watched invoices', async () => {
    const checkpoints = new TestCheckpointStore('100');
    const invA = createMockInvoice('inv-a', 'MEMO-A', 15);
    const invB = createMockInvoice('inv-b', 'MEMO-B', 25);
    const invoicesMap = new Map<string, StoredInvoice>([
      [invA.memo, invA],
      [invB.memo, invB],
    ]);
    const events: Array<{ invoiceId: string; type: string; data: any }> = [];

    const mockInvoicesService = {
      async getInvoiceByMemo(memo: string) {
        return invoicesMap.get(memo) || null;
      },
      async markAsPaid(id: string, hash: string, payer: string) {
        const inv = id === invA.id ? invA : invB;
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
    };

    const source: PaymentPageSource = {
      async getLatestPaymentCursor() {
        return '100';
      },
      async getPaymentsPage(_account, _cursor) {
        return [
          {
            pagingToken: '101',
            ledger: 500,
            payment: {
              id: '101',
              txHash: TX_HASH_1,
              from: PAYER_KEY,
              to: SELLER_KEY,
              amount: '25.0000000',
              assetCode: 'XLM',
              memo: 'MEMO-B',
              memoType: 'text',
              ledger: 500,
              createdAt: '2026-09-15T00:00:00Z',
            },
          },
        ];
      },
    };

    const monitor = new PaymentMonitorService({
      account: SELLER_KEY,
      source,
      invoices: mockInvoicesService as any,
      checkpoints,
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
    });

    monitor.registerWatch(invA);
    monitor.registerWatch(invB);
    assert.equal(monitor.getWatchedCount(), 2);

    const result = await monitor.runOnce();
    assert.equal(result.processed, 1);
    assert.equal(result.cursor, '101');

    assert.equal(invB.status, 'PAID');
    assert.equal(invB.paymentTxHash, TX_HASH_1);
    assert.equal(invA.status, 'PENDING');

    assert.equal(monitor.isWatching('inv-b'), false);
    assert.equal(monitor.isWatching('inv-a'), true);
    assert.equal(monitor.getWatchedCount(), 1);
  });

  it('rejects cross-attribution when transaction hash was already claimed by another invoice', async () => {
    const checkpoints = new TestCheckpointStore('200');
    const inv = createMockInvoice('inv-used', 'MEMO-USED', 10);
    const events: Array<{ invoiceId: string; type: string; data: any }> = [];

    const mockInvoicesService = {
      async getInvoiceByMemo(_memo: string) {
        return inv;
      },
      async markAsPaid() {
        throw new PaymentClaimError(TX_HASH_1, 'inv-used', 'inv-prior-settled');
      },
      async markExpiredInvoices() {
        return 0;
      },
      async logPaymentEvent(invoiceId: string, type: string, data: any) {
        events.push({ invoiceId, type, data });
      },
    };

    const source: PaymentPageSource = {
      async getLatestPaymentCursor() {
        return '200';
      },
      async getPaymentsPage() {
        return [
          {
            pagingToken: '201',
            ledger: 600,
            payment: {
              id: '201',
              txHash: TX_HASH_1,
              from: PAYER_KEY,
              to: SELLER_KEY,
              amount: '10.0000000',
              assetCode: 'XLM',
              memo: 'MEMO-USED',
              memoType: 'text',
              ledger: 600,
              createdAt: '2026-09-15T00:00:00Z',
            },
          },
        ];
      },
    };

    const monitor = new PaymentMonitorService({
      account: SELLER_KEY,
      source,
      invoices: mockInvoicesService as any,
      checkpoints,
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
    });

    monitor.registerWatch(inv);

    const result = await monitor.runOnce();
    assert.equal(result.processed, 1);
    assert.equal(inv.status, 'PENDING');

    const rejection = events.find((e) => e.type === 'PAYMENT_REJECTED');
    assert.ok(rejection);
    assert.equal(rejection.data.code, 'TX_HASH_ALREADY_USED');
  });

  it('handles replayed transaction for already-PAID invoice safely', async () => {
    const checkpoints = new TestCheckpointStore('300');
    const paidInv = createMockInvoice('inv-paid', 'MEMO-PAID', 10);
    paidInv.status = 'PAID';
    paidInv.paymentTxHash = TX_HASH_1;

    let markAsPaidCalled = false;
    const events: Array<{ invoiceId: string; type: string; data: any }> = [];

    const mockInvoicesService = {
      async getInvoiceByMemo() {
        return paidInv;
      },
      async markAsPaid() {
        markAsPaidCalled = true;
        return paidInv;
      },
      async markExpiredInvoices() {
        return 0;
      },
      async logPaymentEvent(invoiceId: string, type: string, data: any) {
        events.push({ invoiceId, type, data });
      },
    };

    const source: PaymentPageSource = {
      async getLatestPaymentCursor() {
        return '300';
      },
      async getPaymentsPage() {
        return [
          {
            pagingToken: '301',
            ledger: 700,
            payment: {
              id: '301',
              txHash: TX_HASH_1,
              from: PAYER_KEY,
              to: SELLER_KEY,
              amount: '10.0000000',
              assetCode: 'XLM',
              memo: 'MEMO-PAID',
              memoType: 'text',
              ledger: 700,
              createdAt: '2026-09-15T00:00:00Z',
            },
          },
        ];
      },
    };

    const monitor = new PaymentMonitorService({
      account: SELLER_KEY,
      source,
      invoices: mockInvoicesService as any,
      checkpoints,
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
    });

    const result = await monitor.runOnce();
    assert.equal(result.processed, 1);
    assert.equal(markAsPaidCalled, false);
    assert.equal(events.length, 0);
  });

  it('rejects payment for already-PAID invoice if incoming transaction hash is different', async () => {
    const checkpoints = new TestCheckpointStore('400');
    const paidInv = createMockInvoice('inv-paid-2', 'MEMO-PAID-2', 10);
    paidInv.status = 'PAID';
    paidInv.paymentTxHash = TX_HASH_1;

    const events: Array<{ invoiceId: string; type: string; data: any }> = [];

    const mockInvoicesService = {
      async getInvoiceByMemo() {
        return paidInv;
      },
      async markAsPaid() {
        return paidInv;
      },
      async markExpiredInvoices() {
        return 0;
      },
      async logPaymentEvent(invoiceId: string, type: string, data: any) {
        events.push({ invoiceId, type, data });
      },
    };

    const source: PaymentPageSource = {
      async getLatestPaymentCursor() {
        return '400';
      },
      async getPaymentsPage() {
        return [
          {
            pagingToken: '401',
            ledger: 800,
            payment: {
              id: '401',
              txHash: TX_HASH_2,
              from: PAYER_KEY,
              to: SELLER_KEY,
              amount: '10.0000000',
              assetCode: 'XLM',
              memo: 'MEMO-PAID-2',
              memoType: 'text',
              ledger: 800,
              createdAt: '2026-09-15T00:00:00Z',
            },
          },
        ];
      },
    };

    const monitor = new PaymentMonitorService({
      account: SELLER_KEY,
      source,
      invoices: mockInvoicesService as any,
      checkpoints,
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
    });

    const result = await monitor.runOnce();
    assert.equal(result.processed, 1);

    const rejection = events.find((e) => e.type === 'PAYMENT_REJECTED');
    assert.ok(rejection);
    assert.equal(rejection.data.code, 'INVOICE_ALREADY_PAID');
    assert.equal(rejection.data.txHash, TX_HASH_2);
  });

  it('exposes status metrics including watchedCount, processedTotal, and lagSeconds', async () => {
    const checkpoints = new TestCheckpointStore('500');
    const source: PaymentPageSource = {
      async getLatestPaymentCursor() {
        return '500';
      },
      async getPaymentsPage() {
        return [];
      },
    };
    const monitor = new PaymentMonitorService({
      account: SELLER_KEY,
      source,
      checkpoints,
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
    });

    monitor.registerWatch(createMockInvoice('inv-status', 'MEMO-STATUS', 10));

    const statusInitial = monitor.getStatus();
    assert.equal(statusInitial.watchedCount, 1);
    assert.equal(statusInitial.processedTotal, 0);

    await monitor.runOnce();

    const statusAfter = monitor.getStatus();
    assert.equal(typeof statusAfter.lastPollAt, 'string');
    assert.equal(typeof statusAfter.lagSeconds, 'number');
    assert.ok(statusAfter.lagSeconds! >= 0);
  });

  it('survives process restart without duplicate processing across instances', async () => {
    const sharedCheckpointStore = new TestCheckpointStore('600');
    const inv = createMockInvoice('inv-restart', 'MEMO-RESTART', 50);

    let settleCount = 0;
    const mockInvoicesService = {
      async getInvoiceByMemo() {
        return inv;
      },
      async markAsPaid(_id: string, hash: string) {
        settleCount += 1;
        inv.status = 'PAID';
        inv.paymentTxHash = hash;
        return inv;
      },
      async markExpiredInvoices() {
        return 0;
      },
      async logPaymentEvent() {},
    };

    let pageDelivered = false;
    const source: PaymentPageSource = {
      async getLatestPaymentCursor() {
        return '600';
      },
      async getPaymentsPage(_account, cursor) {
        if (cursor === '600' && !pageDelivered) {
          pageDelivered = true;
          return [
            {
              pagingToken: '601',
              ledger: 900,
              payment: {
                id: '601',
                txHash: TX_HASH_1,
                from: PAYER_KEY,
                to: SELLER_KEY,
                amount: '50.0000000',
                assetCode: 'XLM',
                memo: 'MEMO-RESTART',
                memoType: 'text',
                ledger: 900,
                createdAt: '2026-09-15T00:00:00Z',
              },
            },
          ];
        }
        return [];
      },
    };

    const instance1 = new PaymentMonitorService({
      account: SELLER_KEY,
      source,
      invoices: mockInvoicesService as any,
      checkpoints: sharedCheckpointStore,
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
    });
    instance1.registerWatch(inv);

    const res1 = await instance1.runOnce();
    assert.equal(res1.processed, 1);
    assert.equal(res1.cursor, '601');
    assert.equal(settleCount, 1);

    const instance2 = new PaymentMonitorService({
      account: SELLER_KEY,
      source,
      invoices: mockInvoicesService as any,
      checkpoints: sharedCheckpointStore,
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
    });

    const res2 = await instance2.runOnce();
    assert.equal(res2.processed, 0);
    assert.equal(res2.cursor, '601');
    assert.equal(settleCount, 1);
  });

  it('handles duplicate records and pages from Horizon without double processing', async () => {
    const checkpoints = new TestCheckpointStore('700');
    const inv = createMockInvoice('inv-dup', 'MEMO-DUP', 10);
    let settleCount = 0;

    const mockInvoicesService = {
      async getInvoiceByMemo() {
        return inv;
      },
      async markAsPaid(_id: string, hash: string) {
        settleCount += 1;
        inv.status = 'PAID';
        inv.paymentTxHash = hash;
        return inv;
      },
      async markExpiredInvoices() {
        return 0;
      },
      async logPaymentEvent() {},
    };

    let pageCall = 0;
    const source: PaymentPageSource = {
      async getLatestPaymentCursor() {
        return '700';
      },
      async getPaymentsPage(_account, cursor) {
        pageCall += 1;
        if (pageCall === 1) {
          return [
            {
              pagingToken: '701',
              ledger: 1000,
              payment: {
                id: '701',
                txHash: TX_HASH_1,
                from: PAYER_KEY,
                to: SELLER_KEY,
                amount: '10.0000000',
                assetCode: 'XLM',
                memo: 'MEMO-DUP',
                memoType: 'text',
                ledger: 1000,
                createdAt: '2026-09-15T00:00:00Z',
              },
            },
          ];
        }
        if (pageCall === 2) {
          return [
            {
              pagingToken: '701',
              ledger: 1000,
              payment: {
                id: '701',
                txHash: TX_HASH_1,
                from: PAYER_KEY,
                to: SELLER_KEY,
                amount: '10.0000000',
                assetCode: 'XLM',
                memo: 'MEMO-DUP',
                memoType: 'text',
                ledger: 1000,
                createdAt: '2026-09-15T00:00:00Z',
              },
            },
          ];
        }
        return [];
      },
    };

    const monitor = new PaymentMonitorService({
      account: SELLER_KEY,
      source,
      invoices: mockInvoicesService as any,
      checkpoints,
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
      pageSize: 1,
      maxPagesPerRun: 5,
    });

    monitor.registerWatch(inv);

    const result = await monitor.runOnce();
    assert.equal(result.processed, 1);
    assert.equal(result.cursor, '701');
    assert.equal(settleCount, 1);
  });

  it('wires watch registration and unregistration to invoice handler lifecycle', async () => {
    const { createInvoiceHandlers } = await import('../src/routes/invoice.handlers');
    const registered: any[] = [];
    const unregistered: string[] = [];

    const mockWatchRegistry = {
      registerWatch(inv: any) {
        registered.push(inv);
      },
      unregisterWatch(id: string) {
        unregistered.push(id);
      },
    };

    let storedInv: any = {
      id: 'inv-lifecycle',
      memo: 'LIFECYCLE-1',
      sellerPublicKey: SELLER_KEY,
      amount: 10,
      assetCode: 'XLM',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };

    const mockStorage = {
      mode: 'memory' as const,
      async createInvoice() {
        return storedInv;
      },
      async getInvoiceById(id: string) {
        return id === storedInv.id ? storedInv : null;
      },
      async cancelInvoice(id: string) {
        storedInv = { ...storedInv, status: 'CANCELLED' };
        return storedInv;
      },
      async markAsPaid(id: string, hash: string, from: string) {
        storedInv = { ...storedInv, status: 'PAID', paymentTxHash: hash, payerPublicKey: from };
        return storedInv;
      },
      countInvoices: async () => 1,
    };

    const handlers = createInvoiceHandlers({
      storage: mockStorage as any,
      paymentMonitor: mockWatchRegistry,
      allowSimulate: true,
    });

    const reqCreate: any = {
      body: {
        sellerPublicKey: SELLER_KEY,
        amount: 10,
        assetCode: 'XLM',
      },
    };
    const resCreate: any = {
      status(code: number) {
        assert.equal(code, 201);
        return this;
      },
      json() {},
    };
    await handlers.createInvoice(reqCreate, resCreate);
    assert.equal(registered.length, 1);
    assert.equal(registered[0].id, 'inv-lifecycle');

    const reqCancel: any = {
      params: { id: 'inv-lifecycle' },
      body: { sellerPublicKey: SELLER_KEY },
    };
    const resCancel: any = {
      status(code: number) {
        assert.equal(code, 200);
        return this;
      },
      json() {},
    };
    await handlers.cancelInvoice(reqCancel, resCancel);
    assert.equal(unregistered.length, 1);
    assert.equal(unregistered[0], 'inv-lifecycle');

    storedInv.status = 'PENDING';
    const reqSim: any = {
      params: { id: 'inv-lifecycle' },
    };
    const resSim: any = {
      status(code: number) {
        assert.equal(code, 200);
        return this;
      },
      json() {},
    };
    await handlers.simulatePayment(reqSim, resSim);
    assert.equal(unregistered.length, 2);
    assert.equal(unregistered[1], 'inv-lifecycle');
  });

  it('serves payment monitor status route with watchedCount, processedTotal, and lagSeconds', async () => {
    const { createPaymentMonitorRouter } = await import('../src/routes/payment-monitor.routes');
    const monitor = new PaymentMonitorService({
      account: SELLER_KEY,
      checkpoints: new TestCheckpointStore('800'),
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
    });
    monitor.registerWatch(createMockInvoice('inv-status-route', 'MEMO-STATUS-ROUTE', 10));

    const router = createPaymentMonitorRouter(monitor);
    const route = (router as any).stack.find(
      (s: any) => s.route?.path === '/payment/monitor/status' && s.route?.methods?.get
    );
    assert.ok(route);

    let responseData: any;
    const req: any = { method: 'GET', url: '/payment/monitor/status' };
    const res: any = {
      json(payload: any) {
        responseData = payload;
      },
    };

    router(req, res, () => {});
    assert.ok(responseData?.success);
    assert.equal(responseData.data.watchedCount, 1);
    assert.equal(responseData.data.processedTotal, 0);
  });
});
