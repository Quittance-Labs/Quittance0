import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { calculateInvoiceStats } from '../src/storage/invoice-stats.ts';
import type { StatsInvoice } from '../src/storage/invoice-stats.ts';
import { MemoryStorage } from '../src/storage/memory-storage.ts';
import type { StoredInvoice } from '../src/storage/invoice-storage.ts';

const sellerA = 'GSELLERA';
const sellerB = 'GSELLERB';
const payerA = 'GPAYERA';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function invoice(
  sellerPublicKey: string,
  amount: number,
  assetCode: string,
  status: StatsInvoice['status'] = 'PENDING'
): StatsInvoice {
  return {
    sellerPublicKey,
    amount,
    assetCode,
    status,
  };
}

describe('calculateInvoiceStats', () => {
  it('groups paid revenue by asset without combining asset values', () => {
    const stats = calculateInvoiceStats([
      invoice(sellerA, 100, 'XLM', 'PAID'),
      invoice(sellerA, 25.5, 'XLM', 'PAID'),
      invoice(sellerA, 50, 'USDC', 'PAID'),
      invoice(sellerA, 999, 'USDC'),
    ], sellerA);

    assert.deepEqual(stats.revenue_by_asset, {
      XLM: 125.5,
      USDC: 50,
    });
    assert.equal(stats.total_invoices, 4);
    assert.equal(stats.paid_invoices, 3);
    assert.equal(stats.pending_invoices, 1);
    assert.equal(stats.actionable_invoices, 1);
  });

  it('keeps expired invoices in history but removes them from actionable stats', () => {
    const all = [
      invoice(sellerA, 10, 'XLM', 'PENDING'),
      invoice(sellerA, 20, 'XLM', 'EXPIRED'),
    ];
    const stats = calculateInvoiceStats(all, sellerA);

    assert.equal(stats.total_invoices, 2);
    assert.equal(stats.pending_invoices, 1);
    assert.equal(stats.actionable_invoices, 1);
    assert.equal(stats.expired_invoices, 1);
  });

  it('only includes invoices belonging to the requested seller', () => {
    const stats = calculateInvoiceStats([
      invoice(sellerA, 10, 'XLM', 'PAID'),
      invoice(sellerB, 20, 'USDC', 'PAID'),
    ], sellerA);

    assert.deepEqual(stats.revenue_by_asset, {
      XLM: 10,
    });
  });

  it('returns an empty revenue map when there are no paid invoices', () => {
    const stats = calculateInvoiceStats([
      invoice(sellerA, 10, 'XLM'),
    ], sellerA);

    assert.deepEqual(stats.revenue_by_asset, {});
  });
});

describe('MemoryStorage parity with Postgres invoice columns', () => {
  let store: MemoryStorage;

  beforeEach(() => {
    store = new MemoryStorage();
  });

  it('createInvoice stores all seller, asset, customer, expiry and metadata columns', () => {
    const created = store.createInvoice({
      sellerPublicKey: sellerA,
      sellerName: 'Seller Alpha',
      sellerEmail: 'alpha@seller.example',
      amount: 199.95,
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
      memo: 'INV-TEST-001',
      description: 'Parity coverage invoice',
      customerName: 'Customer Zed',
      customerEmail: 'zed@customer.example',
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      metadata: { source: 'unit-test', tag: 'parity' },
    });

    assert.equal(created.sellerName, 'Seller Alpha');
    assert.equal(created.sellerEmail, 'alpha@seller.example');
    assert.equal(created.assetCode, 'USDC');
    assert.equal(created.assetIssuer, USDC_ISSUER);
    assert.equal(created.customerName, 'Customer Zed');
    assert.equal(created.customerEmail, 'zed@customer.example');
    assert.equal(created.status, 'PENDING');
    assert.deepEqual(created.metadata, { source: 'unit-test', tag: 'parity' });
    assert.ok(created.id);
    assert.ok(created.createdAt);
    assert.ok(created.expiresAt > created.createdAt);

    const byId = store.getInvoiceById(created.id);
    assert.equal(byId?.sellerEmail, 'alpha@seller.example');
    assert.equal(byId?.assetIssuer, USDC_ISSUER);

    const byMemo = store.getInvoiceByMemo('INV-TEST-001');
    assert.equal(byMemo?.customerEmail, 'zed@customer.example');
  });

  it('defaults assetCode to XLM and leaves metadata undefined when not provided', () => {
    const created = store.createInvoice({
      sellerPublicKey: sellerA,
      amount: 10,
      memo: 'INV-DEFAULTS',
    });

    assert.equal(created.assetCode, 'XLM');
    assert.equal(created.assetIssuer, undefined);
    assert.equal(created.metadata, undefined);
  });

  it('markAsPaid writes txHash, payerPublicKey, name, email and paidAt while refusing expiry', () => {
    const pending = store.createInvoice({
      sellerPublicKey: sellerA,
      amount: 55,
      memo: 'INV-PAYABLE',
    });

    const paid = store.markAsPaid(
      pending.id,
      'abcd'.repeat(16),
      payerA,
      { payerName: 'Nayib Payer', payerEmail: 'nayib@payer.example' }
    );

    assert.equal(paid?.status, 'PAID');
    assert.equal(paid?.paymentTxHash, 'abcd'.repeat(16));
    assert.equal(paid?.payerPublicKey, payerA);
    assert.equal(paid?.payerName, 'Nayib Payer');
    assert.equal(paid?.payerEmail, 'nayib@payer.example');
    assert.ok(paid?.paidAt, 'paidAt must be set after markAsPaid');

    const reget = store.getInvoiceById(pending.id);
    assert.equal(reget?.status, 'PAID');
    assert.equal(reget?.payerEmail, 'nayib@payer.example');

    const secondTry = store.markAsPaid(pending.id, 'wxyz'.repeat(16), payerA);
    assert.equal(secondTry, undefined, 'already-PAID invoice must not accept a second markAsPaid');
  });

  it('markAsPaid returns undefined once expiresAt passes, same guard as Postgres', () => {
    const almostExpired = store.createInvoice({
      sellerPublicKey: sellerA,
      amount: 5,
      memo: 'INV-EXPIRING',
      expiresAt: new Date(Date.now() - 1),
    });

    const result = store.markAsPaid(almostExpired.id, '1234'.repeat(16), payerA);
    assert.equal(result, undefined);

    const reget = store.getInvoiceById(almostExpired.id);
    assert.equal(reget?.status, 'EXPIRED');
  });

  it('cancelInvoice only succeeds for PENDING status, then status is CANCELLED', () => {
    const pending = store.createInvoice({
      sellerPublicKey: sellerA,
      amount: 12,
      memo: 'INV-CANCEL',
    });

    const cancelled = store.cancelInvoice(pending.id, sellerA);
    assert.equal(cancelled?.status, 'CANCELLED');

    const alreadyCancelled = store.cancelInvoice(pending.id, sellerA);
    assert.equal(alreadyCancelled, undefined);
  });

  it('cancelInvoice throws unauthorized when sellerPublicKey does not match', () => {
    const pending = store.createInvoice({
      sellerPublicKey: sellerA,
      amount: 12,
      memo: 'INV-CANCEL-AUTH',
    });

    assert.throws(
      () => store.cancelInvoice(pending.id, sellerB),
      /Unauthorized: only the seller can cancel this invoice/
    );

    const reget = store.getInvoiceById(pending.id);
    assert.equal(reget?.status, 'PENDING');
  });

  it('getAllInvoices + getStats return seller-scoped rows with parity data', () => {
    const a1 = store.createInvoice({ sellerPublicKey: sellerA, amount: 100, assetCode: 'XLM', memo: 'INV-A1' });
    store.createInvoice({ sellerPublicKey: sellerA, amount: 200, assetCode: 'XLM', memo: 'INV-A2' });
    store.markAsPaid(a1.id, 'aaaa'.repeat(16), payerA, { payerName: 'A', payerEmail: 'a@a.example' });
    store.createInvoice({ sellerPublicKey: sellerB, amount: 999, assetCode: 'XLM', memo: 'INV-B1' });

    const onlyA = store.getAllInvoices().filter(inv => inv.sellerPublicKey === sellerA);
    assert.equal(onlyA.length, 2);

    const stats = store.getStats(sellerA);
    assert.equal(stats.total_invoices, 2);
    assert.equal(stats.paid_invoices, 1);
    assert.equal(stats.revenue_by_asset.XLM, 100);

    const onlyBStats = store.getStats(sellerB);
    assert.equal(onlyBStats.total_invoices, 1);
    assert.equal(onlyBStats.paid_invoices, 0);
  });

  it('clear() removes all invoices and size() reports the count', () => {
    assert.equal(store.size(), 0);
    store.createInvoice({ sellerPublicKey: sellerA, amount: 1, memo: 'INV-C1' });
    store.createInvoice({ sellerPublicKey: sellerA, amount: 2, memo: 'INV-C2' });
    assert.equal(store.size(), 2);
    store.clear();
    assert.equal(store.size(), 0);
  });
});
