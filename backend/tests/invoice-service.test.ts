import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InvoiceService } from '../src/services/invoice.service.ts';
import type { Queryable } from '../src/services/invoice.service.ts';
import type { CreateInvoiceInput } from '../src/utils/validation.ts';

const SELLER_A = 'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP';
const SELLER_B = 'GCBAENYI5GN7X7J5ANCI3TMRTAWCRYAVJN3Q5OPZMUXULO5SYIVJQ6AV';

// Column order of the INSERT in invoice.service.ts
const INSERT_COLUMNS = [
  'id',
  'seller_public_key',
  'seller_name',
  'seller_email',
  'amount',
  'asset_code',
  'asset_issuer',
  'memo',
  'description',
  'customer_name',
  'customer_email',
  'status',
  'expires_at',
];

/**
 * Stand-in for the Postgres pool. It stores inserted rows and only applies the
 * seller filter when the SQL actually scopes on seller_public_key, so a query
 * that stopped scoping would leak the other seller's rows into the assertions.
 */
class FakeInvoiceDb implements Queryable {
  rows: Record<string, any>[] = [];
  queries: { text: string; params: any[] }[] = [];

  async query(text: string, params: any[] = []) {
    this.queries.push({ text, params });

    if (text.includes('INSERT INTO invoices')) {
      const row: Record<string, any> = { created_at: new Date() };
      INSERT_COLUMNS.forEach((column, index) => {
        row[column] = params[index] ?? null;
      });
      this.rows.push(row);
      return { rows: [row], rowCount: 1 };
    }

    if (text.includes('FROM invoices')) {
      const scoped = text.includes('seller_public_key = $1')
        ? this.rows.filter(row => row.seller_public_key === params[0])
        : this.rows;

      if (text.includes('COUNT(*)')) {
        const paid = scoped.filter(row => row.status === 'PAID');
        const revenueByAsset: Record<string, number> = {};
        paid.forEach((row) => {
          revenueByAsset[row.asset_code] =
            (revenueByAsset[row.asset_code] || 0) + Number(row.amount);
        });

        return {
          rows: [{
            total_invoices: scoped.length,
            paid_invoices: paid.length,
            pending_invoices: scoped.filter(row => row.status === 'PENDING').length,
            expired_invoices: scoped.filter(row => row.status === 'EXPIRED').length,
            revenue_by_asset: revenueByAsset,
          }],
          rowCount: 1,
        };
      }

      const status = text.includes('status = $2') ? params[1] : undefined;
      const matching = status ? scoped.filter(row => row.status === status) : scoped;
      return { rows: matching, rowCount: matching.length };
    }

    return { rows: [], rowCount: 0 };
  }
}

function input(sellerPublicKey: string, overrides: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    amount: 100,
    sellerPublicKey,
    ...overrides,
  } as CreateInvoiceInput;
}

describe('InvoiceService (Postgres) seller scoping', () => {
  it('stores the invoice under the wallet from the request', async () => {
    const db = new FakeInvoiceDb();
    const service = new InvoiceService(db);

    const invoice = await service.createInvoice(input(SELLER_A, { amount: 12.5 }));

    assert.equal(invoice.sellerPublicKey, SELLER_A);
    assert.equal(db.rows[0].seller_public_key, SELLER_A);
    assert.ok(!db.queries[0].text.includes('user_id'), 'insert must not use the dropped users coupling');
  });

  it('lists only the requesting seller invoices', async () => {
    const db = new FakeInvoiceDb();
    const service = new InvoiceService(db);

    await service.createInvoice(input(SELLER_A, { amount: 10 }));
    await service.createInvoice(input(SELLER_A, { amount: 20 }));

    const sellerAInvoices = await service.getInvoicesBySeller(SELLER_A);
    const sellerBInvoices = await service.getInvoicesBySeller(SELLER_B);

    assert.equal(sellerAInvoices.length, 2);
    assert.ok(sellerAInvoices.every(invoice => invoice.sellerPublicKey === SELLER_A));
    assert.deepEqual(sellerBInvoices, []);
  });

  it('filters by status within the seller scope', async () => {
    const db = new FakeInvoiceDb();
    const service = new InvoiceService(db);

    await service.createInvoice(input(SELLER_A));
    await service.createInvoice(input(SELLER_B));

    const pending = await service.getInvoicesBySeller(SELLER_B, 'PENDING');
    const paid = await service.getInvoicesBySeller(SELLER_B, 'PAID');

    assert.equal(pending.length, 1);
    assert.equal(pending[0].sellerPublicKey, SELLER_B);
    assert.deepEqual(paid, []);
  });

  it('reports stats for the requesting seller only', async () => {
    const db = new FakeInvoiceDb();
    const service = new InvoiceService(db);

    await service.createInvoice(input(SELLER_A, { amount: 30 }));
    await service.createInvoice(input(SELLER_A, { amount: 40 }));
    await service.createInvoice(input(SELLER_B, { amount: 50 }));

    const [statsA] = await service.getInvoiceStats(SELLER_A);
    const [statsB] = await service.getInvoiceStats(SELLER_B);

    assert.equal(statsA.total_invoices, 2);
    assert.equal(statsB.total_invoices, 1);

    const statsQueries = db.queries.filter(entry => entry.text.includes('COUNT(*)'));
    assert.equal(statsQueries.length, 2);
    statsQueries.forEach((entry) => {
      assert.ok(entry.text.includes('seller_public_key = $1'));
      assert.ok([SELLER_A, SELLER_B].includes(entry.params[0]));
    });
  });

  it('requires a seller wallet for create, list and stats', async () => {
    const db = new FakeInvoiceDb();
    const service = new InvoiceService(db);

    await assert.rejects(
      () => service.createInvoice(input('')),
      /Seller public key is required/
    );
    await assert.rejects(
      () => service.getInvoicesBySeller(''),
      /Seller public key is required/
    );
    await assert.rejects(
      () => service.getInvoiceStats(''),
      /Seller public key is required/
    );
    assert.deepEqual(db.queries, []);
  });
});
