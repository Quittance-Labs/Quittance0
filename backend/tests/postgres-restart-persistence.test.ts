// postgres-restart-persistence.test.ts
//
// Issue #452 — Requirement 6 / Requirement 14: Stable public payment IDs.
//
// Demonstrates that the public /pay/[id] identifier of an invoice remains
// stable after the PostgreSQL storage is closed and re-opened.  The test
// simulates a process restart by:
//   1. Creating a PostgresInvoiceStorage backed by an in-process fake database.
//   2. Creating an invoice and capturing its id (the /pay/[id] path segment).
//   3. Discarding the first storage instance (simulating process exit).
//   4. Re-creating a PostgresInvoiceStorage backed by the SAME fake database
//      state (simulating a new process connecting to the same Postgres DB).
//   5. Loading the invoice by its original id from the new storage instance.
//   6. Asserting the returned id, memo, seller, amount, and status are
//      identical to what was captured before the "restart".
//
// No running PostgreSQL database is required.  A live PostgreSQL integration
// test that exercises the actual pg driver is in
// invoice-postgres.integration.test.ts (enabled when DATABASE_URL is set).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PostgresInvoiceStorage } from '../src/storage/postgres-invoice-storage.ts';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage.ts';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service.ts';
import { MemoryStorage } from '../src/storage/memory-storage.ts';
import { InvoiceService } from '../src/services/invoice.service.ts';
import type { StoredInvoice } from '../src/storage/invoice-storage.ts';

// ── Constants ─────────────────────────────────────────────────────────────

const SELLER_A = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const PAYER    = 'GCBIBQVH2B3STCBIYSMTQH6DWKSB2XUGLXH7RGPIN3OXPCFCIQEICVZ6';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const TX_HASH = 'd'.repeat(64);

// ── Shared in-process "database" ──────────────────────────────────────────
//
// Both InvoiceService instances created below share this rows array.  That is
// the persistence model: the same data outlives any one application instance.

function createSharedFakeDatabase() {
  const rows: any[] = [];
  const events: any[] = [];
  const clone = (row: any) => ({ ...row });

  function query(text: string, params: any[] = {}): Promise<{ rows: any[]; rowCount: number | null }> {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('INSERT INTO invoices')) {
      const row = {
        id: params[0],
        seller_public_key: params[1],
        seller_name: params[2],
        seller_email: params[3],
        amount: String(params[4]),
        asset_code: params[5],
        asset_issuer: params[6],
        memo: params[7],
        description: params[8],
        customer_name: params[9],
        customer_email: params[10],
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
      return Promise.resolve({ rows: [clone(row)], rowCount: 1 });
    }

    if (sql.startsWith('INSERT INTO payment_events')) {
      events.push({ invoiceId: params[0], eventType: params[1] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE id =')) {
      const found = rows.filter(r => r.id === params[0]);
      return Promise.resolve({ rows: found.map(clone), rowCount: found.length });
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
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(offset, offset + limit);
      return Promise.resolve({ rows: page.map(clone), rowCount: page.length });
    }

    if (sql.startsWith("SELECT * FROM invoices WHERE status = 'PENDING'")) {
      let found = rows.filter(r => r.status === 'PENDING');
      if (sql.includes('AND seller_public_key =')) {
        found = found.filter(r => r.seller_public_key === params[0]);
      }
      const limit = params[params.length - 1];
      const page = found
        .slice()
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, typeof limit === 'number' ? limit : undefined);
      return Promise.resolve({ rows: page.map(clone), rowCount: page.length });
    }

    if (sql.startsWith("UPDATE invoices SET status = 'EXPIRED'")) {
      const now = new Date(params[0]).getTime();
      const expired = rows.filter(
        r => r.status === 'PENDING' && new Date(r.expires_at).getTime() <= now
      );
      expired.forEach(r => { r.status = 'EXPIRED'; });
      return Promise.resolve({ rows: expired.map(r => ({ id: r.id })), rowCount: expired.length });
    }

    if (sql.startsWith("UPDATE invoices SET status = 'PAID'") || sql.startsWith('WITH settled AS')) {
      const settledAt = params[5] ? new Date(params[5]) : new Date();
      const row = rows.find(
        r => r.id === params[0] &&
          (
            (r.status === 'PENDING' && new Date(r.expires_at).getTime() > Date.now()) ||
            (r.status === 'CANCELLED' && r.cancelled_at && Number.isFinite(settledAt.getTime()))
          )
      );
      if (!row) return Promise.resolve({ rows: [], rowCount: 0 });
      const afterCancel =
        row.status === 'CANCELLED' &&
        settledAt.getTime() >= new Date(row.cancelled_at).getTime();
      Object.assign(row, {
        status: 'PAID',
        payment_tx_hash: params[1],
        payer_public_key: params[2],
        payer_name: params[3],
        payer_email: params[4],
        paid_at: new Date(),
        settled_at: settledAt,
        settlement_context: afterCancel ? 'AFTER_CANCEL' : 'ON_TIME',
        prior_status: row.status === 'CANCELLED' ? 'CANCELLED' : null,
        late_payment_warning_code: afterCancel ? 'PAYMENT_RECEIVED_AFTER_CANCEL' : null,
      });
      return Promise.resolve({ rows: [clone(row)], rowCount: 1 });
    }

    if (sql.startsWith("UPDATE invoices SET status = 'CANCELLED'")) {
      const sellerPublicKey = params[1] ?? null;
      const row = rows.find(
        r => r.id === params[0] &&
          r.status === 'PENDING' &&
          (!sellerPublicKey || r.seller_public_key === sellerPublicKey)
      );
      if (!row) return Promise.resolve({ rows: [], rowCount: 0 });
      row.status = 'CANCELLED';
      row.cancelled_at = new Date();
      return Promise.resolve({ rows: [clone(row)], rowCount: 1 });
    }

    if (sql.startsWith('SELECT COUNT(*) as total_invoices')) {
      const owned = rows.filter(r => r.seller_public_key === params[0]);
      const revenue: Record<string, number> = {};
      owned.filter(r => r.status === 'PAID').forEach(r => {
        revenue[r.asset_code] = (revenue[r.asset_code] || 0) + Number(r.amount);
      });
      return Promise.resolve({
        rows: [{
          total_invoices: String(owned.length),
          paid_invoices: String(owned.filter(r => r.status === 'PAID').length),
          pending_invoices: String(owned.filter(r => r.status === 'PENDING').length),
          actionable_invoices: String(owned.filter(r => r.status === 'PENDING').length),
          expired_invoices: String(owned.filter(r => r.status === 'EXPIRED').length),
          revenue_by_asset: revenue,
        }],
        rowCount: 1,
      });
    }

    if (sql.startsWith('SELECT COUNT(*) as count')) {
      return Promise.resolve({ rows: [{ count: String(rows.length) }], rowCount: 1 });
    }

    return Promise.reject(new Error(`Unhandled query in shared fake database (restart test): ${sql}`));
  }

  // Return both the query function AND the rows array so the factory below can
  // create two different InvoiceService instances that share the same state.
  return { query, rows, events };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Postgres restart persistence — stable public payment IDs (Issue #452)', () => {
  it('resolves a PENDING invoice by its original id after a storage restart', async () => {
    // Shared "database" — survives across service/storage instances.
    const db = createSharedFakeDatabase();

    // ── Before "restart" ──────────────────────────────────────────────────
    const storageBefore = new PostgresInvoiceStorage(new InvoiceService(db));

    const created: StoredInvoice = await storageBefore.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 120,
      assetCode: 'XLM',
      expiresInDays: 7,
    } as any);

    const publicPaymentId = created.id; // the /pay/[id] identifier

    assert.ok(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicPaymentId),
      'public payment id must be a UUID v4'
    );

    // Simulate process exit: storageBefore is no longer referenced.

    // ── After "restart" ───────────────────────────────────────────────────
    // New storage instance pointing to the same database rows.
    const storageAfter = new PostgresInvoiceStorage(new InvoiceService(db));

    const fetched = await storageAfter.getInvoiceById(publicPaymentId);

    assert.ok(fetched, 'invoice must resolve after storage restart');
    assert.equal(fetched.id, publicPaymentId,
      'id returned after restart must be identical to the id captured before restart');
    assert.equal(fetched.sellerPublicKey, SELLER_A);
    assert.equal(fetched.amount, 120);
    assert.equal(fetched.status, 'PENDING');
    assert.equal(fetched.memo, created.memo,
      'memo must be stable — it maps on-chain payments to this invoice');
    assert.equal(fetched.assetCode, created.assetCode);
  });

  it('resolves a PAID invoice with complete payment state after storage restart', async () => {
    const db = createSharedFakeDatabase();

    const storageBefore = new PostgresInvoiceStorage(new InvoiceService(db));

    const created = await storageBefore.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 250,
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
      expiresInDays: 7,
    } as any);

    await storageBefore.markAsPaid(created.id, TX_HASH, PAYER, {
      payerName: 'Satoshi Nakamoto',
      payerEmail: 'satoshi@example.com',
    });

    const publicPaymentId = created.id;

    // "Restart"
    const storageAfter = new PostgresInvoiceStorage(new InvoiceService(db));
    const fetched = await storageAfter.getInvoiceById(publicPaymentId);

    assert.ok(fetched, 'paid invoice must resolve after restart');
    assert.equal(fetched.id, publicPaymentId,
      '/pay/[id] identifier must be stable across restart');
    assert.equal(fetched.status, 'PAID');
    assert.equal(fetched.paymentTxHash, TX_HASH);
    assert.equal(fetched.payerPublicKey, PAYER);
    assert.equal(fetched.payerName, 'Satoshi Nakamoto');
    assert.equal(fetched.payerEmail, 'satoshi@example.com');
    assert.ok(fetched.paidAt, 'paidAt must survive restart');
    assert.equal(fetched.assetCode, 'USDC');
    assert.equal(fetched.assetIssuer, USDC_ISSUER);
    assert.equal(fetched.sellerPublicKey, SELLER_A);
    assert.equal(fetched.amount, 250);
  });

  it('resolves a CANCELLED invoice with cancellation state after storage restart', async () => {
    const db = createSharedFakeDatabase();

    const storageBefore = new PostgresInvoiceStorage(new InvoiceService(db));
    const created = await storageBefore.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 30,
      assetCode: 'XLM',
      expiresInDays: 7,
    } as any);

    await storageBefore.cancelInvoice(created.id, SELLER_A);

    const publicPaymentId = created.id;

    // "Restart"
    const storageAfter = new PostgresInvoiceStorage(new InvoiceService(db));
    const fetched = await storageAfter.getInvoiceById(publicPaymentId);

    assert.ok(fetched, 'cancelled invoice must resolve after restart');
    assert.equal(fetched.id, publicPaymentId,
      '/pay/[id] identifier must be stable after restart');
    assert.equal(fetched.status, 'CANCELLED');
    assert.ok(fetched.cancelledAt, 'cancelledAt must survive restart');
    assert.equal(fetched.sellerPublicKey, SELLER_A);
  });

  it('lists seller invoices correctly after a storage restart', async () => {
    const db = createSharedFakeDatabase();

    const storageBefore = new PostgresInvoiceStorage(new InvoiceService(db));

    const inv1 = await storageBefore.createInvoice({
      sellerPublicKey: SELLER_A, amount: 10, assetCode: 'XLM', expiresInDays: 7,
    } as any);
    const inv2 = await storageBefore.createInvoice({
      sellerPublicKey: SELLER_A, amount: 20, assetCode: 'XLM', expiresInDays: 7,
    } as any);

    // "Restart"
    const storageAfter = new PostgresInvoiceStorage(new InvoiceService(db));

    const listed = await storageAfter.getInvoicesBySeller(SELLER_A);
    const ids = listed.map(r => r.id);

    assert.ok(ids.includes(inv1.id), 'invoice 1 must appear after restart');
    assert.ok(ids.includes(inv2.id), 'invoice 2 must appear after restart');
    assert.ok(listed.every(r => r.sellerPublicKey === SELLER_A));
  });

  it('restart on Postgres returns the same pending set the memory process loses, and the test says so', async () => {
    const memBefore = new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage()));
    await memBefore.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 15,
      assetCode: 'XLM',
      expiresInDays: 7,
    } as any);
    await memBefore.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 25,
      assetCode: 'XLM',
      expiresInDays: 7,
    } as any);

    const memPendingBefore = await memBefore.listPendingInvoices(SELLER_A);
    assert.equal(memPendingBefore.length, 2);

    const memAfter = new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage()));
    const memPendingAfter = await memAfter.listPendingInvoices(SELLER_A);
    assert.equal(
      memPendingAfter.length,
      0,
      'Memory storage loses pending invoices across process restart'
    );

    const db = createSharedFakeDatabase();
    const pgBefore = new PostgresInvoiceStorage(new InvoiceService(db));
    const pgInv1 = await pgBefore.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 15,
      assetCode: 'XLM',
      expiresInDays: 7,
    } as any);
    const pgInv2 = await pgBefore.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 25,
      assetCode: 'XLM',
      expiresInDays: 7,
    } as any);

    const pgPendingBefore = await pgBefore.listPendingInvoices(SELLER_A);
    assert.equal(pgPendingBefore.length, 2);

    const pgAfter = new PostgresInvoiceStorage(new InvoiceService(db));
    const pgPendingAfter = await pgAfter.listPendingInvoices(SELLER_A);
    assert.equal(
      pgPendingAfter.length,
      2,
      'Postgres retains the same pending set across storage restart'
    );
    assert.deepEqual(
      pgPendingAfter.map((i) => i.id).sort(),
      pgPendingBefore.map((i) => i.id).sort(),
      'Postgres returns the exact same pending invoices that memory process lost'
    );
  });
});
