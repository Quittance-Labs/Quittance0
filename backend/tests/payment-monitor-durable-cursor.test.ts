import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PaymentMonitorService, PaymentPageSource } from '../src/services/payment-monitor.service';
import type {
  PaymentMonitorCheckpoint,
  PaymentMonitorCheckpointStore,
} from '../src/services/payment-monitor-checkpoint';
import type { StoredInvoice } from '../src/storage/invoice-storage';
import { withPaymentTransactions } from './fixtures/payment-page-source';

const ACCOUNT = 'GSELLER';
const PAYER = 'GPAYER';
const HASH = 'a'.repeat(64);

class MemoryCheckpoint implements PaymentMonitorCheckpointStore {
  value: PaymentMonitorCheckpoint | null;

  constructor(cursor?: string) {
    this.value = cursor
      ? { account: ACCOUNT, network: 'TESTNET', cursor, updatedAt: new Date() }
      : null;
  }

  async load() {
    return this.value;
  }

  async save(value: Omit<PaymentMonitorCheckpoint, 'updatedAt'>) {
    this.value = { ...value, updatedAt: new Date() };
  }
}

function paymentRecord(token: string, amount = '25.0000000') {
  return {
    pagingToken: token,
    ledger: 123,
    payment: {
      id: token,
      txHash: HASH,
      from: PAYER,
      to: ACCOUNT,
      amount,
      assetCode: 'XLM',
      memo: 'INV-RESTART',
      memoType: 'text',
      ledger: 123,
      createdAt: '2026-09-13T00:00:00Z',
    },
  };
}

function invoiceService() {
  const invoice: StoredInvoice = {
    id: 'invoice-1',
    sellerPublicKey: ACCOUNT,
    amount: 25,
    assetCode: 'XLM',
    memo: 'INV-RESTART',
    status: 'PENDING',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  };
  const events: Array<{ type: string; data: any }> = [];
  return {
    invoice,
    events,
    async getInvoiceByMemo(memo: string) {
      return memo === invoice.memo ? invoice : null;
    },
    async markAsPaid(_id: string, hash: string, payer: string) {
      invoice.status = 'PAID';
      invoice.paymentTxHash = hash;
      invoice.payerPublicKey = payer;
      return invoice;
    },
    async markExpiredInvoices() {
      return 0;
    },
    async logPaymentEvent(_invoiceId: string, type: string, data: any) {
      events.push({ type, data });
    },
  };
}

const database = {
  async query() {
    return { rows: [], rowCount: 1 };
  },
};

describe('PaymentMonitorService durable cursor', () => {
  it('settles a payment created while the monitor is down after a forced restart', async () => {
    const checkpoints = new MemoryCheckpoint('10');
    const invoices = invoiceService();
    let requestedCursor = '';
    const source: PaymentPageSource = withPaymentTransactions({
      async getLatestPaymentCursor() {
        return '10';
      },
      async getPaymentsPage(_account, cursor) {
        requestedCursor = cursor;
        return cursor === '10' ? [paymentRecord('11')] : [];
      },
    });

    // A new service instance represents the restarted process. It receives no
    // cursor through memory; only the durable checkpoint store is shared.
    const restarted = new PaymentMonitorService({
      account: ACCOUNT,
      network: 'TESTNET',
      source,
      invoices,
      checkpoints,
      database,
    });
    const result = await restarted.runOnce();

    assert.equal(requestedCursor, '10');
    assert.equal(result.cursor, '11');
    assert.equal(invoices.invoice.status, 'PAID');
    assert.equal(invoices.invoice.paymentTxHash, HASH);
    assert.equal(checkpoints.value?.cursor, '11');
    assert.equal(checkpoints.value?.ledger, 123);
  });

  it('does not move the cursor past a record whose settlement fails', async () => {
    const checkpoints = new MemoryCheckpoint('20');
    const invoices = invoiceService();
    invoices.markAsPaid = async () => {
      throw new Error('database unavailable');
    };
    const source: PaymentPageSource = withPaymentTransactions({
      async getLatestPaymentCursor() {
        return '20';
      },
      async getPaymentsPage() {
        return [paymentRecord('21'), paymentRecord('22')];
      },
    });
    const monitor = new PaymentMonitorService({
      account: ACCOUNT,
      source,
      invoices,
      checkpoints,
      database,
    });

    await assert.rejects(monitor.runOnce(), /database unavailable/);
    assert.equal(checkpoints.value?.cursor, '20');
  });

  it('records a partial payment and advances past the handled rejection', async () => {
    const checkpoints = new MemoryCheckpoint('30');
    const invoices = invoiceService();
    const source: PaymentPageSource = withPaymentTransactions({
      async getLatestPaymentCursor() {
        return '30';
      },
      async getPaymentsPage(_account, cursor) {
        return cursor === '30' ? [paymentRecord('31', '24.0000000')] : [];
      },
    });
    const monitor = new PaymentMonitorService({
      account: ACCOUNT,
      source,
      invoices,
      checkpoints,
      database,
    });

    await monitor.runOnce();
    assert.equal(invoices.invoice.status, 'PENDING');
    assert.equal(invoices.events[0]?.type, 'PARTIAL_PAYMENT');
    assert.equal(invoices.events[0]?.data.code, 'AMOUNT_TOO_LOW');
    assert.equal(checkpoints.value?.cursor, '31');
  });

  it('anchors a first run at the latest token without an unbounded history scan', async () => {
    const checkpoints = new MemoryCheckpoint();
    let pageCalls = 0;
    const source: PaymentPageSource = withPaymentTransactions({
      async getLatestPaymentCursor() {
        return '999';
      },
      async getPaymentsPage() {
        pageCalls += 1;
        return [];
      },
    });
    const monitor = new PaymentMonitorService({
      account: ACCOUNT,
      source,
      invoices: invoiceService(),
      checkpoints,
      database,
    });

    const result = await monitor.runOnce();
    assert.equal(result.bootstrapped, true);
    assert.equal(result.cursor, '999');
    assert.equal(pageCalls, 0);
  });
});
