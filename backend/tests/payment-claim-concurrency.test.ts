import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import type { Request, Response } from 'express';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { MemoryStorage } from '../src/storage/memory-storage';
import {
  PaymentMonitorService,
  PaymentPageSource,
} from '../src/services/payment-monitor.service';
import {
  PaymentClaimError,
  TxClaimLock,
  txClaimLock,
  claimPayment,
} from '../src/domain/payment-attribution';

const SELLER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const PAYER = 'GCBIBQVH2B3STCBIYSMTQH6DWKSB2XUGLXH7RGPIN3OXPCFCIQEICVZ6';
const TX_HASH = 'e'.repeat(64);
const TX_HASH_2 = 'f'.repeat(64);

class TestCheckpointStore {
  value: any;

  constructor(initialCursor: string = '100') {
    this.value = {
      account: SELLER,
      network: 'TESTNET',
      cursor: initialCursor,
      updatedAt: new Date(),
    };
  }

  async load() {
    return this.value;
  }

  async save(v: any) {
    this.value = { ...v, updatedAt: new Date() };
  }
}

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

function paymentTransaction(memo: string, amount: string = '25.0000000') {
  return {
    transaction: { memo },
    operations: [
      {
        type: 'payment',
        from: PAYER,
        to: SELLER,
        amount,
        asset_type: 'native',
      },
    ],
  };
}

function createPaymentSource(payments: any[]): PaymentPageSource {
  return {
    async getLatestPaymentCursor() {
      return '100';
    },
    async getPaymentsPage() {
      return payments.map((p, idx) => ({
        pagingToken: String(101 + idx),
        ledger: 1000,
        payment: p,
      }));
    },
  };
}

describe('Payment Claim Concurrency & Single Claim Path', () => {
  let memory: MemoryStorage;
  let storage: MemoryInvoiceStorage;

  beforeEach(() => {
    memory = new MemoryStorage();
    storage = new MemoryInvoiceStorage(memory);
    txClaimLock.clear();
  });

  it('serializes concurrent verify and monitor operations on the same hash', async () => {
    const invoice = await storage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 25,
      assetCode: 'XLM',
      memo: 'INV-RACE-1',
    });

    const handlers = createInvoiceHandlers({
      storage,
      frontendUrl: 'http://localhost:3000',
      allowSimulate: false,
      stellar: {
        getTransaction: async () => paymentTransaction(invoice.memo),
      },
    });

    const source = createPaymentSource([
      {
        id: 'op-1',
        txHash: TX_HASH,
        from: PAYER,
        to: SELLER,
        amount: '25.0000000',
        assetCode: 'XLM',
        memo: invoice.memo,
        memoType: 'text',
        ledger: 1000,
        createdAt: new Date().toISOString(),
      },
    ]);

    const monitor = new PaymentMonitorService({
      account: SELLER,
      source,
      invoices: storage.service,
      checkpoints: new TestCheckpointStore('100') as any,
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
    });
    monitor.registerWatch(invoice);

    const verifyReq = createReq({
      params: { id: invoice.id },
      body: { txHash: TX_HASH },
    });

    const [verifyRes, monitorResult] = await Promise.allSettled([
      call(handlers.verifyPayment, verifyReq),
      monitor.runOnce(),
    ]);

    assert.equal(verifyRes.status, 'fulfilled');
    assert.equal(monitorResult.status, 'fulfilled');

    if (verifyRes.status === 'fulfilled') {
      assert.notEqual(verifyRes.value.statusCode, 500);
      assert.ok([200, 400, 409].includes(verifyRes.value.statusCode));
    }

    const latest = await storage.getInvoiceById(invoice.id);
    assert.equal(latest?.status, 'PAID');
    assert.equal(latest?.paymentTxHash, TX_HASH);

    const events = memory.getPaymentEvents(invoice.id);
    const confirmedEvents = events.filter((e) => e.eventType === 'PAYMENT_CONFIRMED');
    assert.equal(confirmedEvents.length, 1);
  });

  it('refuses a second invoice presenting the same transaction hash', async () => {
    const inv1 = await storage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 25,
      assetCode: 'XLM',
      memo: 'INV-SAME-HASH-1',
    });

    const inv2 = await storage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 25,
      assetCode: 'XLM',
      memo: 'INV-SAME-HASH-2',
    });

    const firstClaim = await claimPayment({
      storage,
      invoiceId: inv1.id,
      txHash: TX_HASH,
      payerPublicKey: PAYER,
    });
    assert.equal(firstClaim.kind, 'settled');

    await assert.rejects(
      () =>
        claimPayment({
          storage,
          invoiceId: inv2.id,
          txHash: TX_HASH,
          payerPublicKey: PAYER,
        }),
      (err: any) => {
        assert.ok(err instanceof PaymentClaimError);
        assert.equal(err.code, 'TX_HASH_ALREADY_USED');
        assert.equal(err.settledInvoiceId, inv1.id);
        return true;
      }
    );

    const source = createPaymentSource([
      {
        id: 'op-2',
        txHash: TX_HASH,
        from: PAYER,
        to: SELLER,
        amount: '25.0000000',
        assetCode: 'XLM',
        memo: inv2.memo,
        memoType: 'text',
        ledger: 1001,
        createdAt: new Date().toISOString(),
      },
    ]);

    const monitor = new PaymentMonitorService({
      account: SELLER,
      source,
      invoices: storage.service,
      checkpoints: new TestCheckpointStore('100') as any,
      database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
    });
    monitor.registerWatch(inv2);

    const monitorRes = await monitor.runOnce();
    assert.equal(monitorRes.processed, 1);

    const events = memory.getPaymentEvents(inv2.id);
    const rejection = events.find((e) => e.eventType === 'PAYMENT_REJECTED');
    assert.ok(rejection);
    assert.equal(rejection.eventData?.code, 'TX_HASH_ALREADY_USED');

    const inv2Latest = await storage.getInvoiceById(inv2.id);
    assert.equal(inv2Latest?.status, 'PENDING');
  });

  it('replaying the winning hash never performs a second settle', async () => {
    const invoice = await storage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 25,
      assetCode: 'XLM',
      memo: 'INV-REPLAY-IDEMPOTENT',
    });

    const initialClaim = await claimPayment({
      storage,
      invoiceId: invoice.id,
      txHash: TX_HASH,
      payerPublicKey: PAYER,
    });
    assert.equal(initialClaim.kind, 'settled');

    const replayClaim = await claimPayment({
      storage,
      invoiceId: invoice.id,
      txHash: TX_HASH,
      payerPublicKey: PAYER,
    });
    assert.equal(replayClaim.kind, 'replay');
    assert.equal(replayClaim.invoice.status, 'PAID');

    const events = memory.getPaymentEvents(invoice.id);
    const confirmedEvents = events.filter((e) => e.eventType === 'PAYMENT_CONFIRMED');
    assert.equal(confirmedEvents.length, 1);
  });

  it('fails if verifyPayment bypasses the claim function', async () => {
    const invoice = await storage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 25,
      assetCode: 'XLM',
      memo: 'INV-BYPASS-CHECK-VERIFY',
    });

    let claimPaymentCalled = false;
    const originalAcquire = txClaimLock.acquire.bind(txClaimLock);
    (txClaimLock as any).acquire = async <T>(hash: string, fn: () => Promise<T>): Promise<T> => {
      claimPaymentCalled = true;
      return originalAcquire(hash, fn);
    };

    try {
      const handlers = createInvoiceHandlers({
        storage,
        frontendUrl: 'http://localhost:3000',
        allowSimulate: false,
        stellar: {
          getTransaction: async () => paymentTransaction(invoice.memo),
        },
      });

      const res = await call(
        handlers.verifyPayment,
        createReq({
          params: { id: invoice.id },
          body: { txHash: TX_HASH_2 },
        })
      );

      assert.equal(res.statusCode, 200);
      assert.equal(claimPaymentCalled, true);
    } finally {
      (txClaimLock as any).acquire = originalAcquire;
    }
  });

  it('fails if payment monitor bypasses the claim function', async () => {
    const invoice = await storage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 25,
      assetCode: 'XLM',
      memo: 'INV-BYPASS-CHECK-MONITOR',
    });

    let claimPaymentCalled = false;
    const originalAcquire = txClaimLock.acquire.bind(txClaimLock);
    (txClaimLock as any).acquire = async <T>(hash: string, fn: () => Promise<T>): Promise<T> => {
      claimPaymentCalled = true;
      return originalAcquire(hash, fn);
    };

    try {
      const source = createPaymentSource([
        {
          id: 'op-3',
          txHash: TX_HASH_2,
          from: PAYER,
          to: SELLER,
          amount: '25.0000000',
          assetCode: 'XLM',
          memo: invoice.memo,
          memoType: 'text',
          ledger: 1002,
          createdAt: new Date().toISOString(),
        },
      ]);

      const monitor = new PaymentMonitorService({
        account: SELLER,
        source,
        invoices: storage.service,
        checkpoints: new TestCheckpointStore('100') as any,
        database: { query: async () => ({ rows: [], rowCount: 1 }) } as any,
      });
      monitor.registerWatch(invoice);

      await monitor.runOnce();

      assert.equal(claimPaymentCalled, true);
    } finally {
      (txClaimLock as any).acquire = originalAcquire;
    }
  });
});
