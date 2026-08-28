import assert from 'node:assert/strict';
import { test, describe, beforeEach } from 'node:test';

const { PaymentMonitorService } = await import('../backend/src/services/payment-monitor.service.ts');
const { default: memoryStorage } = await import('../backend/src/storage/memory-storage.ts');

const SELLER_1 = 'GD3DY5W4K4C37Y32F3DZY6QJ23F4Z77L3HRLW2XN2J6L6K6Z5Y2P2K4A';
const SELLER_2 = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWAC';
const PAYER_KEY = 'GB6Y4H5Z2A3B4C5D6E7F8G9H0J1K2L3M4N5P6Q7R8S9T0U1V2W3X4Y5Z';

describe('PaymentMonitorService E2E (Dynamic Seller & Auto-Detection)', () => {
  let monitor;

  beforeEach(() => {
    memoryStorage.invoices.clear();
    monitor = new PaymentMonitorService();
  });

  test('marks pending invoice as PAID when valid payment arrives for dynamic seller', async () => {
    const invoice = memoryStorage.createInvoice({
      sellerPublicKey: SELLER_1,
      amount: 15.5,
      assetCode: 'XLM',
      memo: 'PAY-MEMO-12345',
      expiresAt: new Date(Date.now() + 3600000),
    });

    let receivedEvent = null;
    monitor.subscribeInvoice(invoice.id, (event) => {
      receivedEvent = event;
    });

    const paymentRecord = {
      id: 'op-1',
      txHash: 'txhash-valid-001',
      from: PAYER_KEY,
      to: SELLER_1,
      amount: '15.5000000',
      assetCode: 'XLM',
      memo: 'PAY-MEMO-12345',
      ledger: 100,
      createdAt: new Date().toISOString(),
    };

    const result = await monitor.handlePayment(paymentRecord);
    assert.equal(result.success, true);
    assert.equal(result.invoice.status, 'PAID');
    assert.equal(result.invoice.paymentTxHash, 'txhash-valid-001');

    const updated = memoryStorage.getInvoiceById(invoice.id);
    assert.equal(updated?.status, 'PAID');
    assert.equal(updated?.payerPublicKey, PAYER_KEY);
    assert.equal(receivedEvent?.type, 'paid');
  });

  test('rejects payment with incorrect memo', async () => {
    const invoice = memoryStorage.createInvoice({
      sellerPublicKey: SELLER_1,
      amount: 10,
      assetCode: 'XLM',
      memo: 'CORRECT-MEMO',
      expiresAt: new Date(Date.now() + 3600000),
    });

    const paymentRecord = {
      id: 'op-2',
      txHash: 'txhash-bad-memo',
      from: PAYER_KEY,
      to: SELLER_1,
      amount: '10.0000000',
      assetCode: 'XLM',
      memo: 'WRONG-MEMO',
      ledger: 101,
      createdAt: new Date().toISOString(),
    };

    const result = await monitor.handlePayment(paymentRecord);
    assert.equal(result.success, false);

    const check = memoryStorage.getInvoiceById(invoice.id);
    assert.equal(check?.status, 'PENDING');
  });

  test('rejects payment with incorrect amount', async () => {
    const invoice = memoryStorage.createInvoice({
      sellerPublicKey: SELLER_1,
      amount: 50,
      assetCode: 'XLM',
      memo: 'AMOUNT-MEMO',
      expiresAt: new Date(Date.now() + 3600000),
    });

    const paymentRecord = {
      id: 'op-3',
      txHash: 'txhash-bad-amount',
      from: PAYER_KEY,
      to: SELLER_1,
      amount: '49.9900000',
      assetCode: 'XLM',
      memo: 'AMOUNT-MEMO',
      ledger: 102,
      createdAt: new Date().toISOString(),
    };

    const result = await monitor.handlePayment(paymentRecord);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'Amount mismatch');

    const check = memoryStorage.getInvoiceById(invoice.id);
    assert.equal(check?.status, 'PENDING');
  });

  test('rejects payment with asset mismatch', async () => {
    const invoice = memoryStorage.createInvoice({
      sellerPublicKey: SELLER_1,
      amount: 25,
      assetCode: 'USDC',
      memo: 'ASSET-MEMO',
      expiresAt: new Date(Date.now() + 3600000),
    });

    const paymentRecord = {
      id: 'op-4',
      txHash: 'txhash-bad-asset',
      from: PAYER_KEY,
      to: SELLER_1,
      amount: '25.0000000',
      assetCode: 'XLM',
      memo: 'ASSET-MEMO',
      ledger: 103,
      createdAt: new Date().toISOString(),
    };

    const result = await monitor.handlePayment(paymentRecord);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'Asset mismatch');

    const check = memoryStorage.getInvoiceById(invoice.id);
    assert.equal(check?.status, 'PENDING');
  });

  test('rejects payment with destination seller mismatch', async () => {
    const invoice = memoryStorage.createInvoice({
      sellerPublicKey: SELLER_1,
      amount: 20,
      assetCode: 'XLM',
      memo: 'SELLER-MISMATCH-MEMO',
      expiresAt: new Date(Date.now() + 3600000),
    });

    const paymentRecord = {
      id: 'op-5',
      txHash: 'txhash-bad-dest',
      from: PAYER_KEY,
      to: SELLER_2,
      amount: '20.0000000',
      assetCode: 'XLM',
      memo: 'SELLER-MISMATCH-MEMO',
      ledger: 104,
      createdAt: new Date().toISOString(),
    };

    const result = await monitor.handlePayment(paymentRecord);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'Destination mismatch');

    const check = memoryStorage.getInvoiceById(invoice.id);
    assert.equal(check?.status, 'PENDING');
  });

  test('rejects payment on expired invoice', async () => {
    const invoice = memoryStorage.createInvoice({
      sellerPublicKey: SELLER_1,
      amount: 10,
      assetCode: 'XLM',
      memo: 'EXPIRED-MEMO',
      expiresAt: new Date(Date.now() - 60000), // Expired 1 min ago
    });

    const paymentRecord = {
      id: 'op-6',
      txHash: 'txhash-expired',
      from: PAYER_KEY,
      to: SELLER_1,
      amount: '10.0000000',
      assetCode: 'XLM',
      memo: 'EXPIRED-MEMO',
      ledger: 105,
      createdAt: new Date().toISOString(),
    };

    const result = await monitor.handlePayment(paymentRecord);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'Invoice is expired');

    const check = memoryStorage.getInvoiceById(invoice.id);
    assert.notEqual(check?.status, 'PAID');
  });

  test('handles duplicate/stale payment events idempotently', async () => {
    const invoice = memoryStorage.createInvoice({
      sellerPublicKey: SELLER_1,
      amount: 100,
      assetCode: 'XLM',
      memo: 'IDEMPOTENT-MEMO',
      expiresAt: new Date(Date.now() + 3600000),
    });

    const paymentRecord = {
      id: 'op-7',
      txHash: 'txhash-idempotent-unique',
      from: PAYER_KEY,
      to: SELLER_1,
      amount: '100.0000000',
      assetCode: 'XLM',
      memo: 'IDEMPOTENT-MEMO',
      ledger: 106,
      createdAt: new Date().toISOString(),
    };

    const firstResult = await monitor.handlePayment(paymentRecord);
    assert.equal(firstResult.success, true);
    assert.equal(firstResult.invoice.status, 'PAID');

    const secondResult = await monitor.handlePayment(paymentRecord);
    assert.equal(secondResult.success, true);
    assert.equal(secondResult.reason, 'Already paid (idempotent)');
  });
});
