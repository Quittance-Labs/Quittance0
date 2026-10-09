import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import app from '../src/server-mvp';
import memoryStorage from '../src/storage/memory-storage';
import invoiceMemoryService from '../src/services/invoice-memory.service';
import paymentMonitorService, {
  PaymentMonitorService,
  PaymentPageSource,
} from '../src/services/payment-monitor.service';
import { FilePaymentMonitorCheckpointStore } from '../src/services/payment-monitor-checkpoint';
import { withPaymentTransactions } from './fixtures/payment-page-source';

const SELLER = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const PAYER = 'GB6IHEZ4QNOHJZRYRFLOC45P4SK3KKL6KNPI5WEG6FNVSZ2K5FS2MNY7';
const TX_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function jsonRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        agent: false,
        headers: {
          connection: 'close',
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
          } catch {
            resolve({ status: response.statusCode ?? 0, body: raw });
          }
        });
      }
    );
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

describe('server-mvp payment monitor integration', () => {
  let server: http.Server;
  let port: number;
  let tempDir: string;
  let checkpointFile: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quittance-monitor-test-'));
    checkpointFile = path.join(tempDir, 'checkpoint.json');
    paymentMonitorService.configure({
      account: SELLER,
      network: 'TESTNET',
      source: withPaymentTransactions({
        async getLatestPaymentCursor() {
          return 'cursor-sync-0';
        },
        async getPaymentsPage() {
          return [];
        },
      }),
      checkpoints: new FilePaymentMonitorCheckpointStore(checkpointFile),
    });
    server = await new Promise<http.Server>((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
    memoryStorage.clear();
  });

  it('exposes GET /api/payment/monitor/status with running state', async () => {
    const res = await jsonRequest(port, 'GET', '/api/payment/monitor/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.data.state === 'string');
  });

  it('exposes POST /api/payment/sync with success response', async () => {
    const res = await jsonRequest(port, 'POST', '/api/payment/sync', { limit: 25 });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.limit, 25);
  });

  it('settles an in-memory invoice via PaymentMonitorService runOnce', async () => {
    memoryStorage.clear();
    const invoice = memoryStorage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 10,
      assetCode: 'XLM',
      memo: 'MEMO-MVP-1',
    });
    assert.equal(invoice.status, 'PENDING');

    const source: PaymentPageSource = withPaymentTransactions({
      async getLatestPaymentCursor() {
        return 'cursor-0';
      },
      async getPaymentsPage() {
        return [
          {
            pagingToken: 'cursor-1',
            ledger: 100,
            payment: {
              id: 'payment-1',
              txHash: TX_HASH,
              from: PAYER,
              to: SELLER,
              amount: '10.0000000',
              assetCode: 'XLM',
              memo: 'MEMO-MVP-1',
              memoType: 'text',
              ledger: 100,
              createdAt: new Date().toISOString(),
            },
          },
        ];
      },
    });

    const checkpoints = new FilePaymentMonitorCheckpointStore(checkpointFile);
    await checkpoints.save({
      account: SELLER,
      network: 'TESTNET',
      cursor: 'cursor-0',
    });

    const monitor = new PaymentMonitorService({
      account: SELLER,
      network: 'TESTNET',
      source,
      invoices: invoiceMemoryService,
      checkpoints,
      database: undefined,
    });

    const result = await monitor.runOnce();
    assert.equal(result.processed, 1);

    const settled = memoryStorage.getInvoiceById(invoice.id);
    assert.ok(settled);
    assert.equal(settled.status, 'PAID');
    assert.equal(settled.paymentTxHash, TX_HASH);
    assert.equal(settled.payerPublicKey, PAYER);
    assert.ok(settled.paidAt);

    const savedCheckpoint = await checkpoints.load(SELLER, 'TESTNET');
    assert.ok(savedCheckpoint);
    assert.equal(savedCheckpoint.cursor, 'cursor-1');
  });

  it('records PARTIAL_PAYMENT event in memory storage when underpaid', async () => {
    memoryStorage.clear();
    const invoice = memoryStorage.createInvoice({
      sellerPublicKey: SELLER,
      amount: 50,
      assetCode: 'XLM',
      memo: 'MEMO-MVP-PARTIAL',
    });

    const source: PaymentPageSource = withPaymentTransactions({
      async getLatestPaymentCursor() {
        return 'cursor-1';
      },
      async getPaymentsPage() {
        return [
          {
            pagingToken: 'cursor-2',
            ledger: 101,
            payment: {
              id: 'payment-2',
              txHash: '1111111111111111111111111111111111111111111111111111111111111111',
              from: PAYER,
              to: SELLER,
              amount: '20.0000000',
              assetCode: 'XLM',
              memo: 'MEMO-MVP-PARTIAL',
              memoType: 'text',
              ledger: 101,
              createdAt: new Date().toISOString(),
            },
          },
        ];
      },
    });

    const checkpoints = new FilePaymentMonitorCheckpointStore(checkpointFile);
    await checkpoints.save({
      account: SELLER,
      network: 'TESTNET',
      cursor: 'cursor-1',
    });

    const monitor = new PaymentMonitorService({
      account: SELLER,
      network: 'TESTNET',
      source,
      invoices: invoiceMemoryService,
      checkpoints,
      database: undefined,
    });

    const result = await monitor.runOnce();
    assert.equal(result.processed, 1);

    const unchanged = memoryStorage.getInvoiceById(invoice.id);
    assert.ok(unchanged);
    assert.equal(unchanged.status, 'PENDING');

    const events = await invoiceMemoryService.getPaymentEvents(invoice.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'PARTIAL_PAYMENT');
    assert.equal(events[0].eventData.receivedAmount, '20.0000000');
  });

  it('persists cursor across FilePaymentMonitorCheckpointStore instances', async () => {
    const store1 = new FilePaymentMonitorCheckpointStore(checkpointFile);
    await store1.save({
      account: SELLER,
      network: 'TESTNET',
      cursor: 'cursor-persistent-99',
    });

    const store2 = new FilePaymentMonitorCheckpointStore(checkpointFile);
    const loaded = await store2.load(SELLER, 'TESTNET');
    assert.ok(loaded);
    assert.equal(loaded.account, SELLER);
    assert.equal(loaded.cursor, 'cursor-persistent-99');
  });
});
