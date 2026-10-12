import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PaymentMonitorService,
  PaymentPageSource,
  WatchedInvoiceSeed,
} from '../src/services/payment-monitor.service';
import {
  PaymentMonitorCheckpoint,
  PaymentMonitorCheckpointStore,
  PostgresPaymentMonitorCheckpointStore,
} from '../src/services/payment-monitor-checkpoint';
import {
  LeaderLease,
  PostgresMonitorLeaderLease,
} from '../src/services/monitor-leader-lease';
import { createPaymentMonitorRouter } from '../src/routes/payment-monitor.routes';
import { HorizonUnavailableError } from '../src/utils/horizon-client';
import type { StoredInvoice } from '../src/storage/invoice-storage';

const SELLER_1 = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const SELLER_2 = 'GCFXHS4GXL6BVUCXBWXGTIT5OIFGNQJ54OVHQ3XQ7DBBQMQXBPDMG5XN';
const SELLER_3 = 'GAA5INZB2GO3FJN4VXJYJSSIQXN4EKQTZWTR6R566TR3IMTXHSUDORLI';
const PAYER = 'GB6IHEZ4QNOHJZRYRFLOC45P4SK3KKL6KNPI5WEG6FNVSZ2K5FS2MNY7';

class MemoryMultiCheckpointStore implements PaymentMonitorCheckpointStore {
  public records = new Map<string, PaymentMonitorCheckpoint>();

  private key(account: string, network: string) {
    return `${network}:${account}`;
  }

  async load(account: string, network: string): Promise<PaymentMonitorCheckpoint | null> {
    return this.records.get(this.key(account, network)) || null;
  }

  async save(checkpoint: Omit<PaymentMonitorCheckpoint, 'updatedAt'>): Promise<void> {
    this.records.set(this.key(checkpoint.account, checkpoint.network), {
      ...checkpoint,
      updatedAt: new Date(),
    });
  }
}

function createInvoiceHarness(invoices: StoredInvoice[]) {
  const store = new Map<string, StoredInvoice>(invoices.map((i) => [i.id, i]));
  const memoMap = new Map<string, StoredInvoice>(invoices.map((i) => [i.memo, i]));
  const events: Array<{ invoiceId: string; type: string; data: any }> = [];

  return {
    store,
    events,
    async getInvoiceByMemo(memo: string) {
      return memoMap.get(memo) || null;
    },
    async markAsPaid(id: string, hash: string, payer: string) {
      const inv = store.get(id);
      if (!inv) throw new Error('Not found');
      inv.status = 'PAID';
      inv.paymentTxHash = hash;
      inv.payerPublicKey = payer;
      inv.paidAt = new Date();
      return inv;
    },
    async markExpiredInvoices() {
      return 0;
    },
    async logPaymentEvent(invoiceId: string, type: string, data: any) {
      events.push({ invoiceId, type, data });
    },
    async listPendingInvoices(seller?: string, limit: number = 500) {
      return Array.from(store.values())
        .filter((inv) => inv.status === 'PENDING' && (!seller || inv.sellerPublicKey === seller))
        .slice(0, limit);
    },
  };
}

describe('Multi-seller wallet monitoring (Issue #582)', () => {
  it('settles invoices for two different seller wallets with SELLER_PUBLIC_KEY unset', async () => {
    const invA: StoredInvoice = {
      id: 'inv-seller-1',
      sellerPublicKey: SELLER_1,
      amount: 15,
      assetCode: 'XLM',
      memo: 'MEMO-WALLET-1',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };
    const invB: StoredInvoice = {
      id: 'inv-seller-2',
      sellerPublicKey: SELLER_2,
      amount: 25,
      assetCode: 'XLM',
      memo: 'MEMO-WALLET-2',
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };

    const harness = createInvoiceHarness([invA, invB]);
    const checkpoints = new MemoryMultiCheckpointStore();

    // Mock payments per seller account
    const source: PaymentPageSource = {
      async getLatestPaymentCursor(account: string) {
        return account === SELLER_1 ? 'c1-0' : 'c2-0';
      },
      async getPaymentsPage(account: string, cursor: string) {
        if (account === SELLER_1 && cursor === 'c1-0') {
          return [
            {
              pagingToken: 'c1-1',
              ledger: 100,
              payment: {
                id: 'pay-1',
                txHash: '1'.repeat(64),
                from: PAYER,
                to: SELLER_1,
                amount: '15.0000000',
                assetCode: 'XLM',
                memo: 'MEMO-WALLET-1',
                memoType: 'text',
                ledger: 100,
                createdAt: new Date().toISOString(),
              },
            },
          ];
        }
        if (account === SELLER_2 && cursor === 'c2-0') {
          return [
            {
              pagingToken: 'c2-1',
              ledger: 200,
              payment: {
                id: 'pay-2',
                txHash: '2'.repeat(64),
                from: PAYER,
                to: SELLER_2,
                amount: '25.0000000',
                assetCode: 'XLM',
                memo: 'MEMO-WALLET-2',
                memoType: 'text',
                ledger: 200,
                createdAt: new Date().toISOString(),
              },
            },
          ];
        }
        return [];
      },
    };

    const monitor = new PaymentMonitorService({
      account: undefined, // SELLER_PUBLIC_KEY unset
      network: 'TESTNET',
      source,
      invoices: harness,
      checkpoints,
      database: undefined,
    });

    // Register watches for both seller accounts
    monitor.registerWatch(invA);
    monitor.registerWatch(invB);

    assert.equal(monitor.getWatchedCount(), 2);
    const active = monitor.getActiveAccounts();
    assert.ok(active.includes(SELLER_1));
    assert.ok(active.includes(SELLER_2));

    // First run bootstraps the new accounts
    await monitor.runOnce();
    assert.ok(await checkpoints.load(SELLER_1, 'TESTNET'));
    assert.ok(await checkpoints.load(SELLER_2, 'TESTNET'));

    // Second run polls both accounts and settles invoices
    const runResult = await monitor.runOnce();
    assert.equal(runResult.processed, 2);

    assert.equal(invA.status, 'PAID');
    assert.equal(invA.paymentTxHash, '1'.repeat(64));
    assert.equal(invB.status, 'PAID');
    assert.equal(invB.paymentTxHash, '2'.repeat(64));

    // Both watches unregistered on settlement
    assert.equal(monitor.getWatchedCount(), 0);

    // Cursors are preserved even after accounts go idle
    const status = monitor.getStatus();
    assert.ok(status.accounts);
    assert.equal(status.accounts[SELLER_1]?.cursor, 'c1-1');
    assert.equal(status.accounts[SELLER_2]?.cursor, 'c2-1');
  });

  it('settles a payment that landed between invoice create and first poll', async () => {
    const t0 = new Date('2026-10-13T01:00:00Z');
    const invoice: StoredInvoice = {
      id: 'inv-race',
      sellerPublicKey: SELLER_3,
      amount: 50,
      assetCode: 'XLM',
      memo: 'MEMO-RACE-LANDED',
      status: 'PENDING',
      createdAt: t0,
      expiresAt: new Date(t0.getTime() + 3600_000),
    };

    const harness = createInvoiceHarness([invoice]);
    const checkpoints = new MemoryMultiCheckpointStore();

    // Source contains a payment that landed at 01:00:05Z (after invoice create, before first poll)
    const source: PaymentPageSource = {
      async getLatestPaymentCursor() {
        // "now" would return token 105, which previously skipped the payment
        return 'token-105';
      },
      async getCursorAtOrBefore(_account: string, time: Date | string) {
        const target = new Date(time).getTime();
        // At t0 (01:00:00Z), latest payment before invoice was token-90
        if (target <= t0.getTime()) {
          return 'token-90';
        }
        return 'token-105';
      },
      async getPaymentsPage(_account: string, cursor: string) {
        if (cursor === 'token-90') {
          return [
            {
              pagingToken: 'token-105',
              ledger: 500,
              payment: {
                id: 'pay-race',
                txHash: '3'.repeat(64),
                from: PAYER,
                to: SELLER_3,
                amount: '50.0000000',
                assetCode: 'XLM',
                memo: 'MEMO-RACE-LANDED',
                memoType: 'text',
                ledger: 500,
                createdAt: '2026-10-13T01:00:05Z',
              },
            },
          ];
        }
        return [];
      },
    };

    const monitor = new PaymentMonitorService({
      network: 'TESTNET',
      source,
      invoices: harness,
      checkpoints,
      database: undefined,
    });

    monitor.registerWatch(invoice);

    // Run 1: Bootstraps at or before invoice createdAt (token-90, not token-105)
    const bootResult = await monitor.runOnce();
    assert.equal(bootResult.bootstrapped, true);
    assert.equal(bootResult.cursor, 'token-90');

    // Run 2: Polls from token-90 and captures the payment at token-105
    const pollResult = await monitor.runOnce();
    assert.equal(pollResult.processed, 1);
    assert.equal(invoice.status, 'PAID');
    assert.equal(invoice.paymentTxHash, '3'.repeat(64));

    const cp = await checkpoints.load(SELLER_3, 'TESTNET');
    assert.equal(cp?.cursor, 'token-105');
  });

  it('delays another account by at most one tick when one account fails', async () => {
    const invFail: StoredInvoice = {
      id: 'inv-fail',
      sellerPublicKey: SELLER_1,
      amount: 10,
      assetCode: 'XLM',
      memo: 'MEMO-FAIL',
      status: 'PENDING',
      createdAt: new Date(),
    };
    const invOk: StoredInvoice = {
      id: 'inv-ok',
      sellerPublicKey: SELLER_2,
      amount: 20,
      assetCode: 'XLM',
      memo: 'MEMO-OK',
      status: 'PENDING',
      createdAt: new Date(),
    };

    const harness = createInvoiceHarness([invFail, invOk]);
    const checkpoints = new MemoryMultiCheckpointStore();
    await checkpoints.save({ account: SELLER_1, network: 'TESTNET', cursor: 'c-fail-0' });
    await checkpoints.save({ account: SELLER_2, network: 'TESTNET', cursor: 'c-ok-0' });

    let failCallCount = 0;
    const source: PaymentPageSource = {
      async getLatestPaymentCursor() {
        return '0';
      },
      async getPaymentsPage(account: string, cursor: string) {
        if (account === SELLER_1) {
          failCallCount += 1;
          throw new HorizonUnavailableError('Simulated Horizon 429 Rate Limited', 429);
        }
        if (account === SELLER_2 && cursor === 'c-ok-0') {
          return [
            {
              pagingToken: 'c-ok-1',
              ledger: 300,
              payment: {
                id: 'pay-ok',
                txHash: '4'.repeat(64),
                from: PAYER,
                to: SELLER_2,
                amount: '20.0000000',
                assetCode: 'XLM',
                memo: 'MEMO-OK',
                memoType: 'text',
                ledger: 300,
                createdAt: new Date().toISOString(),
              },
            },
          ];
        }
        return [];
      },
    };

    const monitor = new PaymentMonitorService({
      network: 'TESTNET',
      source,
      invoices: harness,
      checkpoints,
      database: undefined,
    });

    monitor.registerWatch(invFail);
    monitor.registerWatch(invOk);

    // On tick 1: SELLER_1 fails with Horizon error, but SELLER_2 is NOT starved!
    const run1 = await monitor.runOnce();
    assert.equal(invOk.status, 'PAID', 'SELLER_2 invoice must settle even if SELLER_1 failed');
    assert.equal(run1.processed, 1);

    const status1 = monitor.getStatus();
    assert.equal(status1.accounts?.[SELLER_1]?.consecutiveFailures, 1);
    assert.ok(status1.accounts?.[SELLER_1]?.nextRetryAt);

    // On tick 2: SELLER_1 is in backoff window, so it is skipped immediately without delaying anything
    failCallCount = 0;
    await monitor.runOnce();
    assert.equal(failCallCount, 0, 'SELLER_1 should be in backoff and skipped on next tick');
  });

  it('with two monitor instances on one database, only the elected leader polls with takeover on stop', async () => {
    let currentLocked = false;
    let pollCount1 = 0;
    let pollCount2 = 0;

    class MockLease implements LeaderLease {
      public leader = false;
      constructor(private readonly instanceId: number) {}

      isLeader(): boolean {
        return this.leader;
      }
      async tryAcquire(): Promise<boolean> {
        if (!currentLocked) {
          currentLocked = true;
          this.leader = true;
          return true;
        }
        return false;
      }
      async renew(): Promise<boolean> {
        return this.leader;
      }
      async release(): Promise<void> {
        if (this.leader) {
          this.leader = false;
          currentLocked = false;
        }
      }
      async start(): Promise<boolean> {
        return this.tryAcquire();
      }
      async stop(): Promise<void> {
        return this.release();
      }
    }

    const lease1 = new MockLease(1);
    const lease2 = new MockLease(2);

    const source1: PaymentPageSource = {
      async getLatestPaymentCursor() { return '0'; },
      async getPaymentsPage() {
        pollCount1 += 1;
        return [];
      },
    };

    const source2: PaymentPageSource = {
      async getLatestPaymentCursor() { return '0'; },
      async getPaymentsPage() {
        pollCount2 += 1;
        return [];
      },
    };

    const checkpoints = new MemoryMultiCheckpointStore();
    await checkpoints.save({ account: SELLER_1, network: 'TESTNET', cursor: '0' });

    const invoice: StoredInvoice = {
      id: 'inv-replica',
      sellerPublicKey: SELLER_1,
      amount: 10,
      assetCode: 'XLM',
      memo: 'MEMO-REPLICA',
      status: 'PENDING',
      createdAt: new Date(),
    };
    const harness = createInvoiceHarness([invoice]);

    const monitor1 = new PaymentMonitorService({
      network: 'TESTNET',
      source: source1,
      invoices: harness,
      checkpoints,
      lease: lease1,
      pollIntervalMs: 50,
    });
    monitor1.registerWatch(invoice);

    const monitor2 = new PaymentMonitorService({
      network: 'TESTNET',
      source: source2,
      invoices: harness,
      checkpoints,
      lease: lease2,
      pollIntervalMs: 50,
    });
    monitor2.registerWatch(invoice);

    // Start instance 1 -> elected leader
    monitor1.start();
    assert.equal(lease1.isLeader(), true);

    // Start instance 2 -> standby follower
    monitor2.start();
    assert.equal(lease2.isLeader(), false);

    // Wait 120ms: monitor1 polls, monitor2 stays standby
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(pollCount1 > 0, 'Leader must poll');
    assert.equal(pollCount2, 0, 'Follower must not poll');

    // Stop instance 1 -> releases lease
    monitor1.stop();
    assert.equal(lease1.isLeader(), false);

    // Instance 2 acquires lease and takes over
    await lease2.tryAcquire();
    assert.equal(lease2.isLeader(), true);

    // Wait 120ms: monitor2 now polls
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(pollCount2 > 0, 'New leader must poll after takeover');

    monitor2.stop();
  });

  it('PostgresPaymentMonitorCheckpointStore executes queries against payment_monitor_checkpoints table', async () => {
    const executedQueries: Array<{ sql: string; params: any[] }> = [];
    const mockDb = {
      async query(sql: string, params: any[]) {
        executedQueries.push({ sql, params });
        if (sql.includes('SELECT')) {
          return {
            rows: [
              {
                account: SELLER_1,
                network: 'TESTNET',
                cursor: 'pg-cursor-42',
                ledger: 12345,
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
    };

    const store = new PostgresPaymentMonitorCheckpointStore(mockDb);

    // 1. Load checkpoint
    const loaded = await store.load(SELLER_1, 'TESTNET');
    assert.ok(loaded);
    assert.equal(loaded.cursor, 'pg-cursor-42');
    assert.equal(loaded.ledger, 12345);
    assert.ok(executedQueries[0].sql.includes('payment_monitor_checkpoints'));

    // 2. Save checkpoint
    await store.save({
      account: SELLER_2,
      network: 'TESTNET',
      cursor: 'pg-cursor-99',
      ledger: 54321,
    });
    const saveQuery = executedQueries[1];
    assert.ok(saveQuery.sql.includes('INSERT INTO payment_monitor_checkpoints'));
    assert.equal(saveQuery.params[0], SELLER_2);
    assert.equal(saveQuery.params[2], 'pg-cursor-99');
  });

  it('protects POST /api/payment/sync with operator token authorization', async () => {
    const monitor = new PaymentMonitorService();
    const router = createPaymentMonitorRouter(monitor);

    // Mock Express request/response
    async function callSync(headers: Record<string, string>) {
      return new Promise<{ status: number; body: any }>((resolve) => {
        let statusCode = 200;
        let responseBody: any;
        const req: any = {
          headers,
          body: { limit: 10 },
        };
        const res: any = {
          status(code: number) {
            statusCode = code;
            return this;
          },
          json(payload: any) {
            responseBody = payload;
            resolve({ status: statusCode, body: responseBody });
          },
        };
        (router as any).handle(
          { ...req, method: 'POST', url: '/payment/sync' },
          res,
          () => resolve({ status: statusCode, body: responseBody })
        );
      });
    }

    // 1. Missing token -> 401
    const unauth = await callSync({});
    assert.equal(unauth.status, 401);
    assert.equal(unauth.body?.success, false);

    // 2. Invalid token -> 401
    const invalid = await callSync({ authorization: 'Bearer wrong-secret' });
    assert.equal(invalid.status, 401);

    // 3. Valid operator token (via test-operator-token) -> 200
    const valid = await callSync({ authorization: 'Bearer test-operator-token' });
    assert.equal(valid.status, 200);
    assert.equal(valid.body?.success, true);

    // 4. Also supports X-Operator-Token header
    const validHeader = await callSync({ 'x-operator-token': 'test-operator-token' });
    assert.equal(validHeader.status, 200);
    assert.equal(validHeader.body?.success, true);
  });
});
