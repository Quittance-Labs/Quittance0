// invoice-dual-backend.test.ts
//
// Dual-backend contract test for Issue #452.
//
// Exercises the same invoice lifecycle — create / list / get / cancel /
// payment-attribution — against BOTH storage backends through the shared
// InvoiceStorage interface.  The goal is to prove that:
//
//   1. MemoryInvoiceStorage and PostgresInvoiceStorage expose identical
//      behaviour from the application's perspective.
//   2. The public payment ID (invoice.id, the /pay/[id] path segment) is
//      generated at creation time and returned unchanged by every subsequent
//      read — both backends.
//   3. Seller/wallet scoping is enforced at the storage layer for both
//      backends.
//
// The PostgreSQL tests use a fake in-process query handler (the same one used
// by invoice-handlers.test.ts) so no running database is required.  The live
// PostgreSQL integration tests in invoice-postgres.integration.test.ts exercise
// a real database and complement this file; they are not a replacement.

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage.ts';
import { PostgresInvoiceStorage } from '../src/storage/postgres-invoice-storage.ts';
import { InvoiceService } from '../src/services/invoice.service.ts';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service.ts';
import { MemoryStorage } from '../src/storage/memory-storage.ts';
import type { InvoiceStorage, StoredInvoice } from '../src/storage/invoice-storage.ts';

// ── Test constants ───────────────────────────────────────────────────────────

const SELLER_A = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const SELLER_B = 'GB6IHEZ4QNOHJZRYRFLOC45P4SK3KKL6KNPI5WEG6FNVSZ2K5FS2MNY7';
const PAYER    = 'GCBIBQVH2B3STCBIYSMTQH6DWKSB2XUGLXH7RGPIN3OXPCFCIQEICVZ6';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const TX_HASH_1 = 'a'.repeat(64);
const TX_HASH_2 = 'b'.repeat(64);

// ── Fake PostgreSQL in-process query handler ─────────────────────────────────
// Mirrors the one in invoice-handlers.test.ts so both test files exercise the
// same InvoiceService → fake DB path.

function createFakePostgres() {
  const rows: any[] = [];
  const events: any[] = [];
  const clone = (row: any) => ({ ...row });

  const query = async (text: string, params: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('INSERT INTO invoices')) {
      const idempotencyKey = params[13] ?? null;
      if (idempotencyKey !== null) {
        const clash = rows.find(
          (row) =>
            row.seller_public_key === params[1] && row.idempotency_key === idempotencyKey
        );
        if (clash) {
          return { rows: [], rowCount: 0 };
        }
      }
      if (rows.some((row) => row.id === params[0])) {
        const err: any = new Error('duplicate key value violates unique constraint "invoices_pkey"');
        err.code = '23505';
        err.constraint = 'invoices_pkey';
        throw err;
      }
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
        idempotency_key: idempotencyKey,
      };
      rows.push(row);
      return { rows: [clone(row)], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE seller_public_key = $1 AND idempotency_key')) {
      const found = rows.filter(
        (row) => row.seller_public_key === params[0] && row.idempotency_key === params[1]
      );
      return { rows: found.map(clone), rowCount: found.length };
    }

    if (sql.startsWith('INSERT INTO payment_events')) {
      events.push({
        id: `evt-${events.length + 1}`,
        invoiceId: params[0],
        eventType: params[1],
        eventData: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2] ?? null,
        createdAt: new Date(),
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT id, invoice_id, event_type, event_data, created_at FROM payment_events')) {
      const found = events
        .filter((event) => event.invoiceId === params[0])
        .map((event) => ({
          id: event.id,
          invoice_id: event.invoiceId,
          event_type: event.eventType,
          event_data: event.eventData,
          created_at: event.createdAt,
        }));
      return { rows: found.map(clone), rowCount: found.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE id =')) {
      const found = rows.filter(r => r.id === params[0]);
      return { rows: found.map(clone), rowCount: found.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE memo =')) {
      const found = rows.filter(r => r.memo === params[0]);
      return { rows: found.map(clone), rowCount: found.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE seller_public_key =')) {
      let found = rows.filter(r => r.seller_public_key === params[0]);
      if (sql.includes('AND status = $2')) {
        found = found.filter(r => r.status === params[1]);
      }
      const offset = params[params.length - 1];
      const limit = params[params.length - 2];
      const page = found
        .slice()
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(offset, offset + limit);
      return { rows: page.map(clone), rowCount: page.length };
    }

    if (sql.startsWith("SELECT * FROM invoices WHERE status = 'PENDING'")) {
      let found = rows.filter((r) => r.status === 'PENDING');
      if (sql.includes('AND seller_public_key =')) {
        found = found.filter((r) => r.seller_public_key === params[0]);
      }
      const limit = params[params.length - 1];
      const page = found
        .slice()
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, typeof limit === 'number' ? limit : undefined);
      return { rows: page.map(clone), rowCount: page.length };
    }

    if (sql.startsWith('SELECT id FROM invoices WHERE payment_tx_hash = $1')) {
      const found = rows.filter((r) => r.payment_tx_hash === params[0]);
      return { rows: found.map((r) => ({ id: r.id })), rowCount: found.length };
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
          (
            (r.status === 'PENDING' && new Date(r.expires_at).getTime() > Date.now()) ||
            (r.status === 'CANCELLED' && r.cancelled_at && Number.isFinite(settledAt.getTime()))
          )
      );
      if (!row) return { rows: [], rowCount: 0 };
      if (params[1] && rows.some(r => r.payment_tx_hash === params[1] && r.id !== params[0])) {
        const err: any = new Error('duplicate key value violates unique constraint "uq_invoices_payment_tx_hash"');
        err.code = '23505';
        err.constraint = 'uq_invoices_payment_tx_hash';
        throw err;
      }
      const priorStatus = row.status;
      const afterCancel =
        priorStatus === 'CANCELLED' &&
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
        prior_status: priorStatus === 'CANCELLED' ? 'CANCELLED' : null,
        late_payment_warning_code: afterCancel ? 'PAYMENT_RECEIVED_AFTER_CANCEL' : null,
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
      const revenue: Record<string, number> = {};
      owned.filter(r => r.status === 'PAID').forEach(r => {
        revenue[r.asset_code] = (revenue[r.asset_code] || 0) + Number(r.amount);
      });
      return {
        rows: [{
          total_invoices: String(owned.length),
          paid_invoices: String(owned.filter(r => r.status === 'PAID').length),
          pending_invoices: String(owned.filter(r => r.status === 'PENDING').length),
          actionable_invoices: String(owned.filter(r => r.status === 'PENDING').length),
          expired_invoices: String(owned.filter(r => r.status === 'EXPIRED').length),
          revenue_by_asset: revenue,
        }],
        rowCount: 1,
      };
    }

    if (sql.startsWith('SELECT COUNT(*) as count')) {
      return { rows: [{ count: String(rows.length) }], rowCount: 1 };
    }

    throw new Error(`Unhandled query in fake Postgres (dual-backend test): ${sql}`);
  };

  return { query, rows, events };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseInput(sellerPublicKey: string, overrides: Record<string, unknown> = {}) {
  return {
    sellerPublicKey,
    amount: 50,
    assetCode: 'XLM',
    expiresInDays: 7,
    ...overrides,
  } as any;
}

// ── Shared contract suite ────────────────────────────────────────────────────

function runDualBackendSuite(
  backendName: string,
  factory: () => InvoiceStorage,
) {
  describe(`[${backendName}] dual-backend storage contract`, () => {
    let storage: InvoiceStorage;

    beforeEach(() => {
      // Fresh storage for every test — prevents state leaking between cases.
      storage = factory();
    });

    // ── CREATE ────────────────────────────────────────────────────────────────

    describe('createInvoice', () => {
      it('returns a StoredInvoice with all required fields', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A));

        assert.ok(inv.id, 'id must be non-empty');
        assert.match(inv.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          'id must be a UUID v4 (the stable /pay/[id] public identifier)');
        assert.equal(inv.sellerPublicKey, SELLER_A);
        assert.equal(inv.amount, 50);
        assert.equal(inv.assetCode, 'XLM');
        assert.equal(inv.status, 'PENDING');
        assert.match(inv.memo, /^INV-/, 'memo must carry the INV- prefix');
        assert.ok(inv.createdAt instanceof Date || !isNaN(new Date(inv.createdAt).getTime()),
          'createdAt must be a valid date');
        assert.ok(new Date(inv.expiresAt).getTime() > new Date(inv.createdAt).getTime(),
          'expiresAt must be after createdAt');
      });

      it('persists optional seller metadata fields', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A, {
          sellerName: 'Studio A',
          sellerEmail: 'billing@studio-a.example',
          customerName: 'Client B',
          customerEmail: 'pay@client-b.example',
          description: 'Q3 design retainer',
        }));

        assert.equal(inv.sellerName, 'Studio A');
        assert.equal(inv.sellerEmail, 'billing@studio-a.example');
        assert.equal(inv.customerName, 'Client B');
        assert.equal(inv.customerEmail, 'pay@client-b.example');
        assert.equal(inv.description, 'Q3 design retainer');
      });

      it('persists credit asset with assetIssuer', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A, {
          assetCode: 'USDC',
          assetIssuer: USDC_ISSUER,
        }));

        assert.equal(inv.assetCode, 'USDC');
        assert.equal(inv.assetIssuer, USDC_ISSUER);
      });

      it('normalizes assetCode to uppercase', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A, { assetCode: 'xlm' }));
        assert.equal(inv.assetCode, 'XLM');
      });

      it('assigns a distinct id to each invoice (stable public payment ID)', async () => {
        const a = await storage.createInvoice(baseInput(SELLER_A));
        const b = await storage.createInvoice(baseInput(SELLER_A, { amount: 99 }));
        assert.notEqual(a.id, b.id, 'each invoice must receive its own unique id');
      });

      it('assigns distinct memos to concurrent invoices', async () => {
        const a = await storage.createInvoice(baseInput(SELLER_A));
        const b = await storage.createInvoice(baseInput(SELLER_A, { amount: 1 }));
        assert.notEqual(a.memo, b.memo, 'each invoice must carry a unique memo');
      });
    });

    // ── GET ───────────────────────────────────────────────────────────────────

    describe('getInvoiceById', () => {
      it('returns the invoice when found', async () => {
        const created = await storage.createInvoice(baseInput(SELLER_A));
        const fetched = await storage.getInvoiceById(created.id);

        assert.ok(fetched, 'must return the created invoice');
        assert.equal(fetched.id, created.id, 'returned id must match the stored id (stable /pay/[id])');
        assert.equal(fetched.sellerPublicKey, SELLER_A);
        assert.equal(fetched.status, 'PENDING');
      });

      it('returns null for a missing invoice', async () => {
        const result = await storage.getInvoiceById('00000000-0000-4000-8000-000000000000');
        assert.equal(result, null);
      });

      it('does NOT expose invoice by id across sellers — same invoice, different seller context', async () => {
        // getInvoiceById is intentionally NOT seller-scoped (it is the public
        // /pay/[id] lookup path).  The cancel and list operations that are
        // seller-scoped are tested below.  This test just confirms the
        // function returns the invoice regardless of who asks, which is the
        // correct behaviour for the public payment page.
        const created = await storage.createInvoice(baseInput(SELLER_A));
        const fetched = await storage.getInvoiceById(created.id);
        assert.ok(fetched, 'public getInvoiceById should return the invoice regardless of caller');
      });
    });

    // ── LIST ──────────────────────────────────────────────────────────────────

    describe('getInvoicesBySeller', () => {
      it('returns only invoices belonging to the requested seller', async () => {
        const a1 = await storage.createInvoice(baseInput(SELLER_A));
        const a2 = await storage.createInvoice(baseInput(SELLER_A, { amount: 75 }));
        await storage.createInvoice(baseInput(SELLER_B, { amount: 200 }));

        const rows = await storage.getInvoicesBySeller(SELLER_A);
        const ids = rows.map(r => r.id);

        assert.ok(ids.includes(a1.id), 'seller A invoice 1 must appear');
        assert.ok(ids.includes(a2.id), 'seller A invoice 2 must appear');
        assert.ok(rows.every(r => r.sellerPublicKey === SELLER_A),
          'all returned rows must belong to seller A');
      });

      it('returns an empty array for a seller with no invoices', async () => {
        await storage.createInvoice(baseInput(SELLER_A));
        const rows = await storage.getInvoicesBySeller(SELLER_B);
        assert.equal(rows.length, 0);
      });

      it('applies status filter within seller scope', async () => {
        const pending = await storage.createInvoice(baseInput(SELLER_A));
        await storage.cancelInvoice(pending.id, SELLER_A);

        const pendingRows = await storage.getInvoicesBySeller(SELLER_A, 'PENDING');
        const cancelledRows = await storage.getInvoicesBySeller(SELLER_A, 'CANCELLED');

        assert.equal(pendingRows.some(r => r.id === pending.id), false,
          'cancelled invoice must not appear in PENDING filter');
        assert.equal(cancelledRows.some(r => r.id === pending.id), true,
          'cancelled invoice must appear in CANCELLED filter');
      });

      it('applies pagination (limit + offset) within seller scope', async () => {
        await storage.createInvoice(baseInput(SELLER_A, { amount: 1 }));
        await storage.createInvoice(baseInput(SELLER_A, { amount: 2 }));
        await storage.createInvoice(baseInput(SELLER_A, { amount: 3 }));

        const page1 = await storage.getInvoicesBySeller(SELLER_A, undefined, 2, 0);
        const page2 = await storage.getInvoicesBySeller(SELLER_A, undefined, 2, 2);

        assert.equal(page1.length, 2);
        assert.equal(page2.length, 1);
        assert.equal(
          page1.every(r => !page2.some(s => s.id === r.id)),
          true,
          'pages must not overlap'
        );
      });
    });

    // ── CANCEL ────────────────────────────────────────────────────────────────

    describe('cancelInvoice', () => {
      it('transitions PENDING → CANCELLED exactly once', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A));
        const cancelled = await storage.cancelInvoice(inv.id, SELLER_A);

        assert.equal(cancelled.status, 'CANCELLED');
        assert.ok(
          cancelled.cancelledAt instanceof Date ||
          !isNaN(new Date((cancelled as any).cancelledAt).getTime()),
          'cancelledAt must be set'
        );
      });

      it('rejects a second cancel on the same invoice', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A));
        await storage.cancelInvoice(inv.id, SELLER_A);

        await assert.rejects(
          () => storage.cancelInvoice(inv.id, SELLER_A),
          /Invoice not found or already processed/
        );
      });

      it('rejects cancel when sellerPublicKey does not match (cross-seller guard)', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A));

        await assert.rejects(
          () => storage.cancelInvoice(inv.id, SELLER_B),
          /[Uu]nauthorized/
        );
      });

      it('rejects cancel for a missing invoice', async () => {
        await assert.rejects(
          () => storage.cancelInvoice('00000000-0000-4000-8000-000000000000', SELLER_A),
          /Invoice not found or already processed/
        );
      });
    });

    // ── PAYMENT ATTRIBUTION ───────────────────────────────────────────────────

    describe('markAsPaid (payment attribution)', () => {
      it('attributes payment to the correct invoice with all payer fields', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A));
        const paid = await storage.markAsPaid(
          inv.id,
          TX_HASH_1,
          PAYER,
          {
            payerName: 'Hal Finney',
            payerEmail: 'hal@example.com',
          },
          { settledAt: new Date() }
        );

        assert.equal(paid.status, 'PAID');
        assert.equal(paid.paymentTxHash, TX_HASH_1);
        assert.equal(paid.payerPublicKey, PAYER);
        assert.equal(paid.payerName, 'Hal Finney');
        assert.equal(paid.payerEmail, 'hal@example.com');
        assert.ok(paid.paidAt, 'paidAt must be set');
      });

      it('rejects attribution when the invoice has already been paid', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A));
        await storage.markAsPaid(inv.id, TX_HASH_1, PAYER, undefined, { settledAt: new Date() });

        await assert.rejects(
          () => storage.markAsPaid(inv.id, TX_HASH_2, PAYER, undefined, { settledAt: new Date() }),
          /Invoice not found|expired|already processed/
        );
      });

      it('rejects attribution for a missing invoice', async () => {
        await assert.rejects(
          () => storage.markAsPaid('00000000-0000-4000-8000-000000000000', TX_HASH_1, PAYER, undefined, { settledAt: new Date() }),
          /Invoice not found|expired|already processed/
        );
      });

      it('getInvoiceById returns the paid state after successful attribution', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A));
        await storage.markAsPaid(inv.id, TX_HASH_1, PAYER, undefined, { settledAt: new Date() });
        const fetched = await storage.getInvoiceById(inv.id);

        assert.equal(fetched?.status, 'PAID');
        assert.equal(fetched?.paymentTxHash, TX_HASH_1);
      });
    });

    // ── STATS ─────────────────────────────────────────────────────────────────

    describe('getInvoiceStats', () => {
      it('returns counts scoped to the requesting seller', async () => {
        await storage.createInvoice(baseInput(SELLER_A));
        const bInv = await storage.createInvoice(baseInput(SELLER_B, { amount: 100 }));
        await storage.markAsPaid(bInv.id, TX_HASH_1, PAYER, undefined, { settledAt: new Date() });

        const [statsA] = await storage.getInvoiceStats(SELLER_A);
        const [statsB] = await storage.getInvoiceStats(SELLER_B);

        assert.equal(statsA.total_invoices, 1);
        assert.equal(statsA.pending_invoices, 1);
        assert.equal(statsA.paid_invoices, 0);

        assert.equal(statsB.total_invoices, 1);
        assert.equal(statsB.paid_invoices, 1);
        assert.equal(statsB.pending_invoices, 0);
      });

      it('returns zero stats for a seller with no invoices', async () => {
        const [stats] = await storage.getInvoiceStats(SELLER_A);
        assert.equal(stats.total_invoices, 0);
        assert.equal(stats.pending_invoices, 0);
        assert.equal(stats.paid_invoices, 0);
      });
    });

    // ── markExpiredInvoices ───────────────────────────────────────────────────

    describe('markExpiredInvoices', () => {
      it('returns a number (count of rows transitioned)', async () => {
        const count = await storage.markExpiredInvoices(new Date());
        assert.equal(typeof count, 'number');
        assert.ok(count >= 0);
      });
    });

    // ── IDEMPOTENCY & COLLISION ──────────────────────────────────────────────

    describe('idempotent create and id collision', () => {
      it('returns existing invoice on duplicate idempotent create', async () => {
        const input = {
          ...baseInput(SELLER_A),
          idempotencyKey: 'idem-key-1',
        };
        const inv1 = await storage.createInvoice(input as any);
        const inv2 = await storage.createInvoice(input as any);
        assert.equal(inv1.id, inv2.id);
        assert.equal(inv1.memo, inv2.memo);
      });
    });

    // ── PAYMENT EVENTS ────────────────────────────────────────────────────────

    describe('payment-event append and retrieval', () => {
      it('appends and returns payment events in order', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A));
        await storage.logPaymentEvent(inv.id, 'PAYMENT_RECEIVED', { txHash: TX_HASH_1 });
        await storage.logPaymentEvent(inv.id, 'PAYMENT_VERIFIED', { verified: true });

        const events = await storage.getPaymentEvents(inv.id);
        assert.equal(events.length, 2);
        assert.equal(events[0].invoiceId, inv.id);
        assert.equal(events[0].eventType, 'PAYMENT_RECEIVED');
        assert.deepEqual(events[0].eventData, { txHash: TX_HASH_1 });
        assert.equal(events[1].eventType, 'PAYMENT_VERIFIED');
        assert.deepEqual(events[1].eventData, { verified: true });
      });
    });

    // ── MEMO LOOKUP & PENDING INVOICES ────────────────────────────────────────

    describe('memo lookup and pending listing', () => {
      it('retrieves an invoice by memo', async () => {
        const inv = await storage.createInvoice(baseInput(SELLER_A));
        const fetched = await storage.getInvoiceByMemo(inv.memo);
        assert.ok(fetched);
        assert.equal(fetched.id, inv.id);
        assert.equal(fetched.memo, inv.memo);
      });

      it('lists pending invoices scoped to seller', async () => {
        const invA = await storage.createInvoice(baseInput(SELLER_A));
        const invB = await storage.createInvoice(baseInput(SELLER_B));

        const pendingA = await storage.listPendingInvoices(SELLER_A);
        assert.ok(pendingA.some((i) => i.id === invA.id));
        assert.ok(!pendingA.some((i) => i.id === invB.id));
      });
    });

    // ── mode ─────────────────────────────────────────────────────────────────

    describe('storage.mode', () => {
      it('reports the correct backend identifier', () => {
        const expected = backendName === 'in-memory' ? 'in-memory' : 'postgres';
        assert.equal(storage.mode, expected);
      });
    });
  });
}

// ── Run the contract suite against both backends ─────────────────────────────

runDualBackendSuite(
  'in-memory',
  () => new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage())),
);

runDualBackendSuite(
  'postgres',
  () => new PostgresInvoiceStorage(new InvoiceService(createFakePostgres())),
);

describe('InvoiceStorage adapter parity', () => {
  it('exposes the exact same public methods on MemoryInvoiceStorage and PostgresInvoiceStorage', () => {
    const memoryKeys = Object.getOwnPropertyNames(MemoryInvoiceStorage.prototype)
      .filter((k) => k !== 'constructor')
      .sort();
    const postgresKeys = Object.getOwnPropertyNames(PostgresInvoiceStorage.prototype)
      .filter((k) => k !== 'constructor')
      .sort();

    assert.deepEqual(
      memoryKeys,
      postgresKeys,
      'A handler change cannot call a method that exists on only one adapter'
    );
  });
});
