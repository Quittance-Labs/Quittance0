import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InvoiceService } from '../src/services/invoice.service.ts';
import type { Queryable } from '../src/services/invoice.service.ts';
import type { CreateInvoiceInput } from '../src/utils/validation.ts';

const SELLER_A = 'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP';
const SELLER_B = 'GCBAENYI5GN7X7J5ANCI3TMRTAWCRYAVJN3Q5OPZMUXULO5SYIVJQ6AV';
const PAYER = 'GPAYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

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

class FakeInvoiceDb implements Queryable {
  rows: Record<string, any>[] = [];
  queries: { text: string; params: any[] }[] = [];

  async query(text: string, params: any[] = []) {
    this.queries.push({ text, params });
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('INSERT INTO invoices')) {
      const row: Record<string, any> = { created_at: new Date(), paid_at: null, metadata: null };
      INSERT_COLUMNS.forEach((column, index) => {
        row[column] = params[index] ?? null;
      });
      row.payment_tx_hash = null;
      row.payer_public_key = null;
      row.payer_name = null;
      row.payer_email = null;
      this.rows.push(row);
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'EXPIRED'")) {
      const now = new Date(params[0]).getTime();
      const expired = this.rows.filter(
        row => row.status === 'PENDING' && new Date(row.expires_at).getTime() <= now
      );
      expired.forEach(row => { row.status = 'EXPIRED'; });
      return { rows: expired.map(row => ({ id: row.id })), rowCount: expired.length };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'PAID'")) {
      const now = Date.now();
      const row = this.rows.find(
        candidate => candidate.id === params[0] &&
          candidate.status === 'PENDING' &&
          new Date(candidate.expires_at).getTime() > now
      );
      if (!row) {
        return { rows: [], rowCount: 0 };
      }
      row.status = 'PAID';
      row.payment_tx_hash = params[1];
      row.payer_public_key = params[2];
      row.payer_name = params[3];
      row.payer_email = params[4];
      row.paid_at = new Date();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'CANCELLED'")) {
      const row = this.rows.find(
        candidate => candidate.id === params[0] && candidate.status === 'PENDING'
      );
      if (!row) {
        return { rows: [], rowCount: 0 };
      }
      row.status = 'CANCELLED';
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO payment_events')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE id =')) {
      this.applyLazyExpiry();
      const found = this.rows.filter(row => row.id === params[0]);
      return { rows: found.map(r => ({ ...r })), rowCount: found.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE memo =')) {
      this.applyLazyExpiry();
      const found = this.rows.filter(row => row.memo === params[0]);
      return { rows: found.map(r => ({ ...r })), rowCount: found.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE seller_public_key =')) {
      this.applyLazyExpiry();
      let found = this.rows.filter(row => row.seller_public_key === params[0]);
      if (sql.includes('AND status = $2')) {
        found = found.filter(row => row.status === params[1]);
      }
      const offset = params[params.length - 1];
      const limit = params[params.length - 2];
      const page = found
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(offset, offset + limit);
      return { rows: page.map(r => ({ ...r })), rowCount: page.length };
    }

    if (sql.includes('FROM invoices') && (sql.includes('COUNT(*)') || sql.includes('total_invoices'))) {
      this.applyLazyExpiry();
      const scoped = sql.includes('seller_public_key = $1')
        ? this.rows.filter(row => row.seller_public_key === params[0])
        : this.rows;

      if (sql.includes('COUNT(*)')) {
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
            actionable_invoices: scoped.filter(row => row.status === 'PENDING').length,
            expired_invoices: scoped.filter(row => row.status === 'EXPIRED').length,
            revenue_by_asset: revenueByAsset,
          }],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  }

  private applyLazyExpiry(): void {
    const now = Date.now();
    this.rows.forEach(row => {
      if (row.status === 'PENDING' && new Date(row.expires_at).getTime() <= now) {
        row.status = 'EXPIRED';
      }
    });
  }
}

function input(sellerPublicKey: string, overrides: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    amount: 100,
    sellerPublicKey,
    assetCode: 'XLM',
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

  it('persists all parity columns: sellerName/Email, assetIssuer, customer, expiresAt', async () => {
    const db = new FakeInvoiceDb();
    const service = new InvoiceService(db);

    const created = await service.createInvoice(input(SELLER_A, {
      amount: 250,
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
      sellerName: 'Acme Inc',
      sellerEmail: 'billing@acme.example',
      customerName: 'Beta LLC',
      customerEmail: 'finance@beta.example',
      description: 'Parity column test invoice',
      expiresInDays: 10,
    }));

    assert.equal(created.sellerName, 'Acme Inc');
    assert.equal(created.sellerEmail, 'billing@acme.example');
    assert.equal(created.assetCode, 'USDC');
    assert.equal(created.assetIssuer, USDC_ISSUER);
    assert.equal(created.customerName, 'Beta LLC');
    assert.equal(created.customerEmail, 'finance@beta.example');
    assert.equal(created.description, 'Parity column test invoice');

    const hours = (new Date(created.expiresAt).getTime() - new Date(created.createdAt).getTime()) / (60 * 60 * 1000);
    assert.ok(hours >= 10 * 24 - 1, `expiry should be ~10 days, was ${hours}h`);
    assert.ok(hours <= 10 * 24 + 1, `expiry should be ~10 days, was ${hours}h`);

    const rawRow = db.rows[0];
    assert.equal(rawRow.seller_name, 'Acme Inc');
    assert.equal(rawRow.seller_email, 'billing@acme.example');
    assert.equal(rawRow.asset_issuer, USDC_ISSUER);
    assert.equal(rawRow.customer_name, 'Beta LLC');
    assert.equal(rawRow.customer_email, 'finance@beta.example');
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

    const statsQueries = db.queries.filter(entry => entry.text.includes('COUNT(*)') || entry.text.includes('total_invoices'));
    assert.ok(statsQueries.length >= 2);
    statsQueries.forEach((entry) => {
      assert.ok(entry.text.includes('seller_public_key = $1'));
      assert.ok([SELLER_A, SELLER_B].includes(entry.params[0]));
    });
  });

  it('persists expiry before read, list, and stats responses', async () => {
    const db = new FakeInvoiceDb();
    const service = new InvoiceService(db);
    const created = await service.createInvoice(input(SELLER_A, { expiresInDays: 1 }));
    db.rows[0].expires_at = new Date(Date.now() - 1);

    assert.equal((await service.getInvoiceById(created.id))?.status, 'EXPIRED');
    assert.equal((await service.getInvoicesBySeller(SELLER_A))[0].status, 'EXPIRED');

    const [stats] = await service.getInvoiceStats(SELLER_A);
    assert.equal(stats.pending_invoices, 0);
    assert.equal(stats.actionable_invoices, 0);
    assert.equal(stats.expired_invoices, 1);
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

  it('markAsPaid writes all payer columns: txHash, payerKey, payerName, payerEmail, paidAt', async () => {
    const db = new FakeInvoiceDb();
    const service = new InvoiceService(db);
    const created = await service.createInvoice(input(SELLER_A, { amount: 99 }));
    const txHash = 'f'.repeat(64);

    const paid = await service.markAsPaid(created.id, txHash, PAYER, {
      payerName: 'Alan Turing',
      payerEmail: 'alan@bletchley.example',
    });

    assert.equal(paid.status, 'PAID');
    assert.equal(paid.paymentTxHash, txHash);
    assert.equal(paid.payerPublicKey, PAYER);
    assert.equal(paid.payerName, 'Alan Turing');
    assert.equal(paid.payerEmail, 'alan@bletchley.example');
    assert.ok(paid.paidAt);
    assert.ok(new Date(paid.paidAt).getTime() >= new Date(created.createdAt).getTime());

    const raw = db.rows[0];
    assert.equal(raw.payment_tx_hash, txHash);
    assert.equal(raw.payer_public_key, PAYER);
    assert.equal(raw.payer_name, 'Alan Turing');
    assert.equal(raw.payer_email, 'alan@bletchley.example');
  });

  it('markAsPaid refuses an invoice whose expiresAt has already passed', async () => {
    const db = new FakeInvoiceDb();
    const service = new InvoiceService(db);
    const created = await service.createInvoice(input(SELLER_A, { expiresInDays: 1 }));
    db.rows[0].expires_at = new Date(Date.now() - 60_000);

    await assert.rejects(
      () => service.markAsPaid(created.id, 'e'.repeat(64), PAYER),
      /Invoice not found, expired, or already processed/
    );

    const fetched = await service.getInvoiceById(created.id);
    assert.equal(fetched?.status, 'EXPIRED');
  });

  it('cancelInvoice flips status to CANCELLED only when PENDING', async () => {
    const db = new FakeInvoiceDb();
    const service = new InvoiceService(db);
    const pending = await service.createInvoice(input(SELLER_A, { amount: 1 }));

    const cancelled = await service.cancelInvoice(pending.id);
    assert.equal(cancelled.status, 'CANCELLED');

    await assert.rejects(
      () => service.cancelInvoice(pending.id),
      /Invoice not found or already processed/
    );
  });

  it('cancelInvoice permits cancellation when sellerPublicKey matches and rejects when mismatched', async () => {
    const db = new FakeInvoiceDb();
    const service = new InvoiceService(db);
    const pending = await service.createInvoice(input(SELLER_A, { amount: 1 }));

    await assert.rejects(
      () => service.cancelInvoice(pending.id, SELLER_B),
      /Unauthorized: only the seller can cancel this invoice/
    );

    const cancelled = await service.cancelInvoice(pending.id, SELLER_A);
    assert.equal(cancelled.status, 'CANCELLED');
  });
});
