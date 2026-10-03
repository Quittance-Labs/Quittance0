// cross-seller-isolation.test.ts
//
// Issue #452 — Requirement 7: Cross-seller/wallet isolation.
//
// Explicitly proves that no seller can read or mutate another seller's private
// invoice records through the repository API, against BOTH storage backends.
//
// The public payment lookup path (getInvoiceById) is intentionally NOT
// seller-scoped — it is the /pay/[id] endpoint that any payer can reach.
// These tests make that distinction explicit.  The seller-scoped operations
// (list, stats, cancel, payment attribution) are all hardened.

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage.ts';
import { PostgresInvoiceStorage } from '../src/storage/postgres-invoice-storage.ts';
import { InvoiceService } from '../src/services/invoice.service.ts';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service.ts';
import { MemoryStorage } from '../src/storage/memory-storage.ts';
import type { InvoiceStorage } from '../src/storage/invoice-storage.ts';

// ── Constants ─────────────────────────────────────────────────────────────

const SELLER_A = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const SELLER_B = 'GB6IHEZ4QNOHJZRYRFLOC45P4SK3KKL6KNPI5WEG6FNVSZ2K5FS2MNY7';
const PAYER    = 'GCBIBQVH2B3STCBIYSMTQH6DWKSB2XUGLXH7RGPIN3OXPCFCIQEICVZ6';
const TX_HASH  = 'e'.repeat(64);

// ── Shared fake PostgreSQL state ───────────────────────────────────────────

function createFakePostgres() {
  const rows: any[] = [];
  const clone = (row: any) => ({ ...row });

  const query = async (text: string, params: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('INSERT INTO invoices')) {
      const row = {
        id: params[0],
        seller_public_key: params[1],
        seller_name: null,
        seller_email: null,
        amount: String(params[4]),
        asset_code: params[5],
        asset_issuer: null,
        memo: params[7],
        description: null,
        customer_name: null,
        customer_email: null,
        status: params[11],
        expires_at: params[12],
        payment_tx_hash: null,
        payer_public_key: null,
        payer_name: null,
        payer_email: null,
        created_at: new Date(),
        paid_at: null,
        cancelled_at: null,
        settled_at: null,
        settlement_context: null,
        prior_status: null,
        late_payment_warning_code: null,
        metadata: null,
      };
      rows.push(row);
      return { rows: [clone(row)], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO payment_events')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE id =')) {
      const found = rows.filter(r => r.id === params[0]);
      return { rows: found.map(clone), rowCount: found.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE seller_public_key =')) {
      let found = rows.filter(r => r.seller_public_key === params[0]);
      if (sql.includes('AND status = $2')) {
        found = found.filter(r => r.status === params[1]);
      }
      const offset = params[params.length - 1];
      const limit  = params[params.length - 2];
      const page = found
        .slice()
        .sort((a: any, b: any) => b.created_at.getTime() - a.created_at.getTime())
        .slice(offset, offset + limit);
      return { rows: page.map(clone), rowCount: page.length };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'EXPIRED'")) {
      const now = new Date(params[0]).getTime();
      const expired = rows.filter(
        r => r.status === 'PENDING' && new Date(r.expires_at).getTime() <= now
      );
      expired.forEach(r => { r.status = 'EXPIRED'; });
      return { rows: expired.map(r => ({ id: r.id })), rowCount: expired.length };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'PAID'") || sql.startsWith('WITH settled AS')) {
      const settledAt = params[5] ? new Date(params[5]) : new Date();
      const row = rows.find(
        r => r.id === params[0] &&
          r.status === 'PENDING' &&
          new Date(r.expires_at).getTime() > Date.now()
      );
      if (!row) return { rows: [], rowCount: 0 };
      Object.assign(row, {
        status: 'PAID',
        payment_tx_hash: params[1],
        payer_public_key: params[2],
        payer_name: params[3],
        payer_email: params[4],
        paid_at: new Date(),
        settled_at: settledAt,
        settlement_context: 'ON_TIME',
        prior_status: null,
        late_payment_warning_code: null,
      });
      return { rows: [clone(row)], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'CANCELLED'")) {
      const sellerPublicKey = params[1] ?? null;
      const row = rows.find(
        r => r.id === params[0] &&
          r.status === 'PENDING' &&
          (!sellerPublicKey || r.seller_public_key === sellerPublicKey)
      );
      if (!row) return { rows: [], rowCount: 0 };
      row.status = 'CANCELLED';
      row.cancelled_at = new Date();
      return { rows: [clone(row)], rowCount: 1 };
    }

    if (sql.startsWith('SELECT COUNT(*) as total_invoices')) {
      const owned = rows.filter(r => r.seller_public_key === params[0]);
      return {
        rows: [{
          total_invoices: String(owned.length),
          paid_invoices: String(owned.filter(r => r.status === 'PAID').length),
          pending_invoices: String(owned.filter(r => r.status === 'PENDING').length),
          actionable_invoices: String(owned.filter(r => r.status === 'PENDING').length),
          expired_invoices: String(owned.filter(r => r.status === 'EXPIRED').length),
          revenue_by_asset: {},
        }],
        rowCount: 1,
      };
    }

    if (sql.startsWith('SELECT COUNT(*) as count')) {
      return { rows: [{ count: String(rows.length) }], rowCount: 1 };
    }

    throw new Error(`Unhandled query (cross-seller-isolation): ${sql}`);
  };

  return { query };
}

// ── Shared isolation suite ─────────────────────────────────────────────────

function runIsolationSuite(backendName: string, factory: () => InvoiceStorage) {
  describe(`[${backendName}] cross-seller isolation (Issue #452 §7)`, () => {
    let storage: InvoiceStorage;
    let invoiceA: any; // Seller A's invoice

    beforeEach(async () => {
      storage = factory();
      // Create an invoice for Seller A
      invoiceA = await storage.createInvoice({
        sellerPublicKey: SELLER_A,
        amount: 100,
        assetCode: 'XLM',
        expiresInDays: 7,
      } as any);
    });

    // ── LIST isolation ─────────────────────────────────────────────────────

    it('Seller B cannot list Seller A invoices', async () => {
      // Add a Seller B invoice so storage is not trivially empty.
      await storage.createInvoice({
        sellerPublicKey: SELLER_B,
        amount: 50,
        assetCode: 'XLM',
        expiresInDays: 7,
      } as any);

      const bRows = await storage.getInvoicesBySeller(SELLER_B);
      assert.equal(
        bRows.some(r => r.id === invoiceA.id),
        false,
        'Seller B must not see Seller A invoice in their list'
      );
      assert.ok(
        bRows.every(r => r.sellerPublicKey === SELLER_B),
        'every row returned to Seller B must belong to Seller B'
      );
    });

    it('Seller B list returns only Seller B invoices when both sellers have invoices', async () => {
      const bInv = await storage.createInvoice({
        sellerPublicKey: SELLER_B,
        amount: 200,
        assetCode: 'XLM',
        expiresInDays: 7,
      } as any);

      const [aRows, bRows] = await Promise.all([
        storage.getInvoicesBySeller(SELLER_A),
        storage.getInvoicesBySeller(SELLER_B),
      ]);

      assert.ok(aRows.some(r => r.id === invoiceA.id), 'Seller A sees their own invoice');
      assert.ok(bRows.some(r => r.id === bInv.id), 'Seller B sees their own invoice');
      assert.equal(aRows.some(r => r.id === bInv.id), false, 'Seller A must not see Seller B invoice');
      assert.equal(bRows.some(r => r.id === invoiceA.id), false, 'Seller B must not see Seller A invoice');
    });

    // ── STATS isolation ────────────────────────────────────────────────────

    it('Seller B stats do not reflect Seller A invoices', async () => {
      // Seller A has one pending invoice; Seller B has none.
      const [statsA] = await storage.getInvoiceStats(SELLER_A);
      const [statsB] = await storage.getInvoiceStats(SELLER_B);

      assert.equal(statsA.total_invoices, 1, 'Seller A should see their 1 invoice');
      assert.equal(statsB.total_invoices, 0, 'Seller B should see 0 invoices');
    });

    it('Seller B stats are isolated from Seller A payment state', async () => {
      // Pay Seller A invoice, then confirm Seller B stats are unaffected.
      await storage.markAsPaid(invoiceA.id, TX_HASH, PAYER, undefined, { settledAt: new Date() });

      const [statsA] = await storage.getInvoiceStats(SELLER_A);
      const [statsB] = await storage.getInvoiceStats(SELLER_B);

      assert.equal(statsA.paid_invoices, 1, 'Seller A: 1 paid invoice');
      assert.equal(statsB.paid_invoices, 0, 'Seller B must not see Seller A paid invoice in their stats');
      assert.equal(statsB.total_invoices, 0, 'Seller B total must be 0');
    });

    // ── CANCEL isolation ───────────────────────────────────────────────────

    it('Seller B cannot cancel Seller A invoice', async () => {
      await assert.rejects(
        () => storage.cancelInvoice(invoiceA.id, SELLER_B),
        /[Uu]nauthorized/,
        'cancelInvoice must throw Unauthorized when caller is not the seller'
      );

      // Invoice must remain PENDING — Seller B's attempt must not change state.
      const fetched = await storage.getInvoiceById(invoiceA.id);
      assert.equal(fetched?.status, 'PENDING',
        'Seller A invoice must remain PENDING after Seller B cancel attempt');
    });

    it('Seller A can still cancel their own invoice after Seller B was rejected', async () => {
      // Ensure the rejection above does not corrupt state.
      try {
        await storage.cancelInvoice(invoiceA.id, SELLER_B);
      } catch {
        // Expected rejection — continue.
      }

      const cancelled = await storage.cancelInvoice(invoiceA.id, SELLER_A);
      assert.equal(cancelled.status, 'CANCELLED',
        'Seller A must still be able to cancel their own invoice');
    });

    // ── PAYMENT ATTRIBUTION isolation ──────────────────────────────────────
    //
    // markAsPaid uses the invoice id, not a seller key — it is the Horizon
    // verification path that gates access (checks memo, destination = seller
    // wallet, amount, asset).  At the storage layer, attribution is id-scoped.
    // Cross-seller blocking at the API level is tested in invoice-handlers.test.ts
    // (destination mismatch → DESTINATION_MISMATCH).  The storage-layer test
    // below verifies that paying Seller A's invoice does not show up in
    // Seller B's stats or list.

    it('paying Seller A invoice does not appear in Seller B list or stats', async () => {
      await storage.markAsPaid(invoiceA.id, TX_HASH, PAYER, undefined, { settledAt: new Date() });

      const bList = await storage.getInvoicesBySeller(SELLER_B);
      assert.equal(bList.some(r => r.id === invoiceA.id), false,
        'paid Seller A invoice must not appear in Seller B list');

      const [bStats] = await storage.getInvoiceStats(SELLER_B);
      assert.equal(bStats.paid_invoices, 0,
        'Seller A payment must not increment Seller B paid count');
    });

    // ── PUBLIC /pay/[id] lookup (intentionally NOT seller-scoped) ──────────
    //
    // getInvoiceById is the public payment page lookup.  Any payer — including
    // Seller B when acting as a payer — must be able to fetch the invoice by its
    // opaque id.  This is by design: the id is an opaque UUID that reveals no
    // wallet information other than what the payer already has to navigate to
    // the URL.

    it('getInvoiceById returns the invoice regardless of the caller identity (public path)', async () => {
      // Simulating Seller B / any payer fetching the /pay/[id] page.
      const fetched = await storage.getInvoiceById(invoiceA.id);
      assert.ok(fetched, 'getInvoiceById must return the invoice — public /pay/[id] path');
      assert.equal(fetched.id, invoiceA.id);
      assert.equal(fetched.sellerPublicKey, SELLER_A);
    });
  });
}

// ── Run isolation suite against both backends ──────────────────────────────

runIsolationSuite(
  'in-memory',
  () => new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage())),
);

runIsolationSuite(
  'postgres',
  () => new PostgresInvoiceStorage(new InvoiceService(createFakePostgres())),
);
