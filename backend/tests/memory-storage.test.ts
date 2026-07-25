import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateInvoiceStats } from '../src/storage/invoice-stats.ts';
import type { StatsInvoice } from '../src/storage/invoice-stats.ts';

const sellerA = 'GSELLERA';
const sellerB = 'GSELLERB';

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
