import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createHash } from 'node:crypto';
import { server, STELLAR_NETWORK } from '../src/config/stellar';
import stellarService, { type HorizonTransactionDetails } from '../src/services/stellar.service';
import { PaymentMonitorService } from '../src/services/payment-monitor.service';
import type { PaymentMonitorCheckpoint, PaymentMonitorCheckpointStore } from '../src/services/payment-monitor-checkpoint';
import { MemoryStorage } from '../src/storage/memory-storage';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { createInvoiceRouter } from '../src/routes/invoice.routes';
import type { VerificationCache } from '../src/middleware/verify-cache';
import { normalizePaymentOperation, type ExpectedPayment } from '../src/services/payment-verification';
import { USDC_VERIFY_CASES } from './fixtures/usdc-verify-edge-cases.fixture';
import receipts from './fixtures/monitor-testnet-receipts.json';

const SELLER = 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU';
const PAYER = 'GCT7D6S5VTFGEURS6ZYIO33YZRPQMA3LNWB4GEOHDFDXZGWTA4EPIM5E';
const HASH = 'a'.repeat(64);
const CLOSE_TIME = '2026-10-01T12:00:00Z';

class Checkpoints implements PaymentMonitorCheckpointStore {
  saved: Array<Omit<PaymentMonitorCheckpoint, 'updatedAt'>> = [];
  constructor(public cursor = '0') {}
  async load(account: string, network: string) {
    return { account, network, cursor: this.cursor, updatedAt: new Date() };
  }
  async save(value: Omit<PaymentMonitorCheckpoint, 'updatedAt'>) {
    this.saved.push(value);
    this.cursor = value.cursor;
  }
}

/** Only Horizon I/O is doubled: the service, monitor, storage and HTTP route are real. */
function horizon(t: TestContext, details: HorizonTransactionDetails, hash: string, effects: any[] = []) {
  const counts = { pages: 0, transactions: 0, operations: 0, effects: 0 };
  const rows = details.operations.map((operation, index) => ({
    id: String(index + 1), paging_token: String(index + 1),
    transaction_hash: hash, created_at: details.transaction.created_at,
    ...operation,
  }));
  t.mock.method(server, 'operations', () => {
    let account = false;
    let cursor = '0';
    const builder = {
      forAccount() { account = true; return this; },
      forTransaction(requested: string) { assert.equal(requested, hash); return this; },
      cursor(value: string) { cursor = value; return this; },
      order(value: string) { assert.equal(value, 'asc'); return this; },
      limit(value: number) { if (!account) assert.equal(value, 200, 'read every transaction operation, not Horizon default 10'); return this; },
      async call() {
        if (account) {
          counts.pages += 1;
          return { records: rows.filter((row: any) => BigInt(row.paging_token) > BigInt(cursor)) };
        }
        counts.operations += 1;
        return { records: rows };
      },
    };
    return builder as any;
  });
  t.mock.method(server, 'transactions', () => ({
    transaction(requested: string) {
      assert.equal(requested, hash);
      return { async call() { counts.transactions += 1; return { ledger_attr: 123, ...details.transaction }; } };
    },
  } as any));
  t.mock.method(server, 'effects', () => ({
    forOperation() { return this; }, limit() { return this; },
    async call() { counts.effects += 1; return { records: effects }; },
  } as any));
  const source = {
    getPaymentsPage: stellarService.getPaymentsPage.bind(stellarService),
    getLatestPaymentCursor: stellarService.getLatestPaymentCursor.bind(stellarService),
    async getTransaction(txHash: string, observed?: HorizonTransactionDetails['transaction']) {
      return { ...await stellarService.getTransaction(txHash, observed), network: details.network ?? STELLAR_NETWORK };
    },
  };
  return { counts, rows, source };
}

function invoices(expected: ExpectedPayment) {
  const memory = new MemoryStorage();
  const invoice = memory.createInvoice({
    sellerPublicKey: expected.destination,
    amount: Number(expected.amount), assetCode: expected.assetCode,
    assetIssuer: expected.assetIssuer, memo: expected.memo,
    expiresAt: new Date('2099-01-01T00:00:00Z'),
  });
  const service = new InvoiceMemoryService(memory);
  return { memory, invoice, service, storage: new MemoryInvoiceStorage(service) };
}

async function postVerify(storage: MemoryInvoiceStorage, invoiceId: string, hash: string, network?: string) {
  const app = express();
  app.use(express.json());
  app.use('/api', createInvoiceRouter({
    storage, stellar: stellarService, enableRateLimiting: false,
    enableConcurrencyLock: false, enableCeilingCheck: false, enableVerifyCache: false,
    verifyCache: { set: async () => undefined } as unknown as VerificationCache,
  }));
  const listener = await new Promise<http.Server>((resolve) => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  try {
    const payload = JSON.stringify({ txHash: hash, network });
    return await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1', port: (listener.address() as AddressInfo).port,
        method: 'POST', path: `/api/invoices/${invoiceId}/verify`, agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      }, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(body) }));
      });
      request.on('error', reject);
      request.end(payload);
    });
  } finally {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
}

async function parity(t: TestContext, expected: ExpectedPayment, details: HorizonTransactionDetails, hash: string) {
  const io = horizon(t, details, hash);
  const manual = invoices(expected);
  const response = await postVerify(manual.storage, manual.invoice.id, hash, details.network ?? STELLAR_NETWORK);
  const watched = invoices(expected);
  const checkpoint = new Checkpoints();
  const beforeOperations = io.counts.operations;
  const beforeTransactions = io.counts.transactions;
  const monitor = new PaymentMonitorService({
    account: expected.destination, network: STELLAR_NETWORK, source: io.source,
    invoices: watched.service, checkpoints: checkpoint, database: undefined,
  });
  await monitor.runOnce();
  const monitorPaid = watched.memory.getInvoiceById(watched.invoice.id)?.status === 'PAID';
  const manualPaid = manual.memory.getInvoiceById(manual.invoice.id)?.status === 'PAID';
  assert.equal(monitorPaid, manualPaid, 'monitor and HTTP route must agree on settlement');
  assert.equal(response.body.success, manualPaid);
  assert.equal(response.status, manualPaid ? 200 : 400);
  const events = await watched.service.getPaymentEvents(watched.invoice.id);
  const verificationEvents = events.filter((event) => ['PARTIAL_PAYMENT', 'PAYMENT_REJECTED'].includes(event.eventType));
  if (verificationEvents.length) assert.equal(verificationEvents[0].eventData?.code, response.body.code);
  assert.ok(io.counts.operations - beforeOperations <= 1, 'one full operations lookup per candidate transaction');
  assert.ok(io.counts.transactions - beforeTransactions <= 1, 'reuse the observed transaction envelope');
  assert.equal(checkpoint.saved.length, io.rows.length, 'checkpoint each record, including irrelevant operations');
  return { manualPaid, monitorPaid, response, events, checkpoint, io, watched };
}

describe('monitor and HTTP verify: every existing USDC fixture', () => {
  for (const [index, fixture] of USDC_VERIFY_CASES.entries()) {
    it(fixture.name, async (t) => {
      const input = structuredClone(fixture.input);
      // Legacy no-memo captures are verifier examples, not invoice payments.
      // Replay them with an explicit synthetic invoice memo and close time.
      // No captured JSON is rewritten. Preserve all asset/amount/destination cases.
      if (!input.expected.memo) {
        input.expected.memo = `INV-585-REPLAY-${index}`;
        input.transaction.memo = input.expected.memo;
        input.transaction.memo_type = 'text';
      }
      input.transaction.created_at = CLOSE_TIME;
      // HTTP's invoice network is server-configured. Retain the fixture's
      // mismatch relation when this test process is configured for TESTNET.
      const mismatch = input.network !== input.expected.network;
      input.expected.network = STELLAR_NETWORK;
      input.network = mismatch ? (STELLAR_NETWORK === 'TESTNET' ? 'PUBLIC' : 'TESTNET') : STELLAR_NETWORK;
      const result = await parity(t, input.expected, {
        transaction: input.transaction, operations: input.operations, network: input.network,
      }, input.txHash);
      assert.equal(result.monitorPaid, fixture.expectedResult);
      if (!fixture.expectedResult) assert.equal(result.response.body.code, fixture.expectedCode);
    });
  }
});

const payment = (overrides: Record<string, unknown> = {}) => ({
  type: 'payment', from: PAYER, to: SELLER, amount: '10.0000000', asset_type: 'native', ...overrides,
});
const expected = { memo: 'INV-585-MULTI', amount: '10.0000000', destination: SELLER, assetCode: 'XLM' };
const transaction = { memo: expected.memo, memo_type: 'text', created_at: CLOSE_TIME };

describe('complete transaction selection and cursor progress', () => {
  it('finds the unique seller payment after more than ten unrelated operations', async (t) => {
    const operations = [...Array.from({ length: 12 }, () => ({ type: 'manage_data' })), payment()];
    const result = await parity(t, expected, { transaction, operations }, HASH);
    assert.equal(result.monitorPaid, true);
    assert.equal(result.checkpoint.cursor, '13');
  });
  it('rejects two seller payments once, instead of settling the first page record', async (t) => {
    const result = await parity(t, expected, { transaction, operations: [payment(), payment()] }, HASH);
    assert.equal(result.monitorPaid, false);
    assert.equal(result.response.body.code, 'AMBIGUOUS_PAYMENT_OPERATION');
    assert.equal(result.events.length, 1);
    assert.equal(result.checkpoint.cursor, '2');
  });
  for (const type of ['account_merge', 'create_account']) {
    it(`${type} with an invoice memo produces a typed rejection`, async (t) => {
      const operation = type === 'account_merge'
        ? { type, account: PAYER, into: SELLER }
        : { type, funder: PAYER, account: SELLER, starting_balance: '10.0000000' };
      const result = await parity(t, expected, { transaction, operations: [operation] }, HASH);
      assert.equal(result.monitorPaid, false);
      assert.equal(result.response.body.code, 'UNSUPPORTED_PAYMENT_OPERATION');
      assert.equal(result.events[0].eventType, 'PAYMENT_REJECTED');
      assert.equal(result.events[0].eventData?.operationType, type);
    });
  }
});

function receipt(name: string) {
  const item = receipts.cases.find((entry) => entry.name === name)!;
  const resources = item.resources as unknown as Record<string, { raw_utf8: string; sha256: string; bytes: number; status: number }>;
  const read = (key: string) => JSON.parse(resources[key].raw_utf8);
  const transaction = read('transaction');
  const operations = read(resources.operations ? 'operations' : 'transaction-operations')._embedded.records;
  return { item, resources, read, transaction, operations };
}

describe('unchanged public testnet receipts', () => {
  it('retains the exact captured response bytes and testnet network provenance', () => {
    const resources = [receipts.network_resource, ...receipts.cases.flatMap((entry) => Object.values(entry.resources))];
    for (const resource of resources) {
      assert.equal(resource.status, 200);
      assert.equal(Buffer.byteLength(resource.raw_utf8), resource.bytes);
      assert.equal(createHash('sha256').update(resource.raw_utf8).digest('hex'), resource.sha256);
    }
    assert.equal(JSON.parse(receipts.network_resource.raw_utf8).network_passphrase, receipts.network_passphrase);
  });
  it('settles the real strict-receive envelope against a constructed invoice with its unchanged text memo', async (t) => {
    const raw = receipt('strict_receive_xlm_to_usdc');
    const operation = normalizePaymentOperation(raw.operations[0])!;
    const result = await parity(t, {
      memo: raw.transaction.memo, destination: operation.to, amount: operation.amount,
      assetCode: operation.assetCode!, assetIssuer: operation.assetIssuer,
    }, { transaction: raw.transaction, operations: raw.operations }, raw.item.transaction_hash);
    assert.equal(result.monitorPaid, true);
    assert.equal(result.watched.memory.getInvoiceById(result.watched.invoice.id)?.settledAt?.toISOString(), new Date(raw.transaction.created_at).toISOString());
  });
  it('preserves real strict-send destination USDC without inventing an invoice memo', async (t) => {
    const raw = receipt('strict_send_xlm_to_usdc');
    const io = horizon(t, { transaction: raw.transaction, operations: raw.operations }, raw.item.transaction_hash);
    const page = await io.source.getPaymentsPage(raw.operations[0].to, '0', 100);
    const received = page.find((row) => row.payment)?.payment!;
    assert.equal(received.operationType, 'path_payment_strict_send');
    assert.equal(received.amount, '945.1853873');
    assert.equal(received.assetCode, 'USDC');
    assert.equal(received.assetIssuer, raw.operations[0].asset_issuer);
    assert.equal(received.memo, undefined);
    assert.notEqual(received.amount, raw.operations[0].source_amount);
    assert.notEqual(received.amount, raw.operations[0].destination_min);
  });
  it('settles a clearly synthetic memo-bearing derivative of the real strict-send shape', async (t) => {
    const raw = receipt('strict_send_xlm_to_usdc');
    const operation = normalizePaymentOperation(raw.operations[0])!;
    const memo = 'INV-585-SYNTHETIC-SEND';
    const result = await parity(t, {
      memo, destination: operation.to, amount: operation.amount,
      assetCode: operation.assetCode!, assetIssuer: operation.assetIssuer,
    }, { transaction: { ...raw.transaction, memo_type: 'text', memo }, operations: raw.operations }, raw.item.transaction_hash);
    assert.equal(result.monitorPaid, true);
  });
  it('logs a real claimable balance once across cursor replay and monitor restart, leaving the invoice pending', async (t) => {
    const raw = receipt('claimable_native_text_memo');
    const effects = raw.read('effects')._embedded.records;
    const io = horizon(t, { transaction: raw.transaction, operations: raw.operations }, raw.item.transaction_hash, effects);
    const claimant = raw.item.test_claimant!;
    const target = invoices({ memo: raw.transaction.memo, destination: claimant, amount: '12.3300000', assetCode: 'XLM' });
    const checkpoint = new Checkpoints();
    const options = { account: claimant, network: STELLAR_NETWORK, source: io.source, invoices: target.service, checkpoints: checkpoint, database: undefined, database: undefined };
    await new PaymentMonitorService(options).runOnce();
    checkpoint.cursor = '0'; // crash after audit write but before durable cursor save
    await new PaymentMonitorService(options).runOnce();
    const events = await target.service.getPaymentEvents(target.invoice.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'CLAIMABLE_BALANCE_RECEIVED');
    assert.deepEqual(events[0].eventData, {
      balanceId: raw.item.balance_id, amount: '12.3300000', asset: 'native',
      predicate: { unconditional: true }, txHash: raw.item.transaction_hash, source: 'payment-monitor',
    });
    assert.equal(target.memory.getInvoiceById(target.invoice.id)?.status, 'PENDING');
    assert.equal(io.counts.operations, 0, 'claim hints do not enter invoice settlement');
    const feed = raw.read('claimant-operations')._embedded.records;
    assert.ok(feed.some((operation: any) => operation.id === raw.operations[0].id));
  });
  it('does not advance past a claimable operation when its creation effect is unavailable', async (t) => {
    const raw = receipt('claimable_native_text_memo');
    const io = horizon(t, { transaction: raw.transaction, operations: raw.operations }, raw.item.transaction_hash);
    const target = invoices({ memo: raw.transaction.memo, destination: raw.item.test_claimant!, amount: '12.3300000', assetCode: 'XLM' });
    const checkpoint = new Checkpoints();
    const monitor = new PaymentMonitorService({
      account: raw.item.test_claimant!, source: io.source, invoices: target.service, checkpoints: checkpoint, database: undefined,
    });
    await assert.rejects(monitor.runOnce(), /creation effect is unavailable/);
    assert.equal(checkpoint.cursor, '0');
    assert.equal((await target.service.getPaymentEvents(target.invoice.id)).length, 0);
  });
});
