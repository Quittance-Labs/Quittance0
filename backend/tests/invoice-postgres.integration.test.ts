import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { Keypair } from '@stellar/stellar-sdk';
import { InvoiceService } from '../src/services/invoice.service.ts';
import type { CreateInvoiceInput } from '../src/utils/validation.ts';
import { PostgresInvoiceStorage } from '../src/storage/postgres-invoice-storage.ts';
import type { PayerInfo, StoredInvoice } from '../src/storage/invoice-storage.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const SCHEMA_PATH = path.join(__dirname, '../../db/schema.sql');
const SEED_PATH = path.join(__dirname, '../../db/seed.sql');

const SELLER_A = Keypair.random().publicKey();
const SELLER_B = Keypair.random().publicKey();
const PAYER = Keypair.random().publicKey();
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function createInput(sellerPublicKey: string, overrides: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    amount: 100,
    sellerPublicKey,
    assetCode: 'XLM',
    ...overrides,
  } as CreateInvoiceInput;
}

describe('Invoice persistence on Postgres', { skip: DATABASE_URL ? false : 'DATABASE_URL is not set' }, () => {
  let adminPool: Pool;

  before(async () => {
    adminPool = new Pool({ connectionString: DATABASE_URL });
    await adminPool.query(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  });

  after(async () => {
    await adminPool.query('DELETE FROM payment_events WHERE invoice_id IN (SELECT id FROM invoices WHERE seller_public_key = ANY($1))', [[SELLER_A, SELLER_B]]);
    await adminPool.query('DELETE FROM invoices WHERE seller_public_key = ANY($1)', [[SELLER_A, SELLER_B]]);
    await adminPool.end();
  });

  it('keeps seller A invoices for a new connection and hides them from seller B', async () => {
    const writePool = new Pool({ connectionString: DATABASE_URL });
    const created = await new InvoiceService(writePool).createInvoice(createInput(SELLER_A, {
      amount: 42.5,
      description: 'Integration test invoice',
    }));
    await writePool.end();

    const readPool = new Pool({ connectionString: DATABASE_URL });
    const service = new InvoiceService(readPool);

    try {
      const sellerAInvoices = await service.getInvoicesBySeller(SELLER_A);
      assert.equal(sellerAInvoices.length >= 1, true);
      const found = sellerAInvoices.find(inv => inv.id === created.id);
      assert.ok(found, 'created invoice should appear in seller A list');
      assert.equal(found?.sellerPublicKey, SELLER_A);

      const sellerBInvoices = await service.getInvoicesBySeller(SELLER_B);
      assert.equal(sellerBInvoices.some(inv => inv.id === created.id), false);

      const [statsA] = await service.getInvoiceStats(SELLER_A);
      assert.ok(Number(statsA.total_invoices) >= 1);

      const [statsB] = await service.getInvoiceStats(SELLER_B);
      assert.equal(Number(statsB.total_invoices), 0);
    } finally {
      await readPool.end();
    }
  });

  it('persists all seller metadata, asset issuer, customer and expiry fields on create', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const service = new InvoiceService(pool);

    try {
      const created = await service.createInvoice(createInput(SELLER_A, {
        amount: 299.99,
        assetCode: 'USDC',
        assetIssuer: USDC_ISSUER,
        sellerName: 'Acme Freelance',
        sellerEmail: 'billing@acme.example',
        customerName: 'Widget Corp',
        customerEmail: 'ap@widget.example',
        description: 'Q2 quarterly retainer',
        expiresInDays: 14,
      }));

      assert.equal(created.sellerName, 'Acme Freelance');
      assert.equal(created.sellerEmail, 'billing@acme.example');
      assert.equal(created.assetCode, 'USDC');
      assert.equal(created.assetIssuer, USDC_ISSUER);
      assert.equal(created.customerName, 'Widget Corp');
      assert.equal(created.customerEmail, 'ap@widget.example');
      assert.equal(created.status, 'PENDING');
      assert.ok(created.memo.startsWith('INV-'), 'memo should start with INV- prefix');
      assert.ok(created.expiresAt > created.createdAt, 'expiresAt must be after createdAt');

      const lifetimeHours = (new Date(created.expiresAt).getTime() - new Date(created.createdAt).getTime()) / (60 * 60 * 1000);
      assert.ok(lifetimeHours >= 14 * 24 - 1, `expiry should be ~14 days, got ${lifetimeHours}h`);
      assert.ok(lifetimeHours <= 14 * 24 + 1, `expiry should be ~14 days, got ${lifetimeHours}h`);

      const fetched = await service.getInvoiceById(created.id);
      assert.ok(fetched);
      assert.equal(fetched.sellerName, created.sellerName);
      assert.equal(fetched.sellerEmail, created.sellerEmail);
      assert.equal(fetched.assetIssuer, created.assetIssuer);
      assert.equal(fetched.customerName, created.customerName);
      assert.equal(fetched.customerEmail, created.customerEmail);
      assert.equal(fetched.amount, created.amount);
    } finally {
      await pool.end();
    }
  });

  it('defaults assetCode to XLM and omits assetIssuer for native asset', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const service = new InvoiceService(pool);

    try {
      const created = await service.createInvoice(createInput(SELLER_A, { amount: 10 }));
      assert.equal(created.assetCode, 'XLM');
      assert.equal(created.assetIssuer, null);
    } finally {
      await pool.end();
    }
  });

  it('lists invoices with status filter and pagination within seller scope', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const service = new InvoiceService(pool);

    try {
      const inv1 = await service.createInvoice(createInput(SELLER_A, { amount: 1 }));
      const inv2 = await service.createInvoice(createInput(SELLER_A, { amount: 2 }));
      await service.cancelInvoice(inv2.id);

      const allPending = await service.getInvoicesBySeller(SELLER_A, 'PENDING');
      assert.ok(allPending.some(i => i.id === inv1.id));
      assert.equal(allPending.some(i => i.id === inv2.id), false, 'cancelled invoice must not appear in PENDING filter');

      const allCancelled = await service.getInvoicesBySeller(SELLER_A, 'CANCELLED');
      assert.equal(allCancelled.some(i => i.id === inv2.id), true);
      assert.equal(allCancelled.some(i => i.id === inv1.id), false);

      const limited = await service.getInvoicesBySeller(SELLER_A, undefined, 1, 0);
      assert.equal(limited.length, 1);

      const offset = await service.getInvoicesBySeller(SELLER_A, undefined, 1, 1);
      assert.equal(offset.length, 1);
      assert.notEqual(limited[0].id, offset[0].id, 'different offsets should return distinct rows');
    } finally {
      await pool.end();
    }
  });

  it('marks invoices PAID with full payer info (payerPublicKey, name, email, txHash, paidAt)', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const service = new InvoiceService(pool);

    try {
      const created = await service.createInvoice(createInput(SELLER_A, { amount: 77.77 }));
      const txHash = 'a'.repeat(64);
      const payerInfo: PayerInfo = { payerName: 'Grace Hopper', payerEmail: 'grace@example.com' };

      const paid = await service.markAsPaid(created.id, txHash, PAYER, payerInfo);

      assert.equal(paid.status, 'PAID');
      assert.equal(paid.paymentTxHash, txHash);
      assert.equal(paid.payerPublicKey, PAYER);
      assert.equal(paid.payerName, 'Grace Hopper');
      assert.equal(paid.payerEmail, 'grace@example.com');
      assert.ok(paid.paidAt, 'paidAt must be set after markAsPaid');
      assert.ok(new Date(paid.paidAt).getTime() >= new Date(created.createdAt).getTime());

      const fetched = await service.getInvoiceById(created.id);
      assert.ok(fetched);
      assert.equal(fetched.status, 'PAID');
      assert.equal(fetched.paymentTxHash, txHash);
      assert.equal(fetched.payerName, 'Grace Hopper');
      assert.equal(fetched.payerEmail, 'grace@example.com');
    } finally {
      await pool.end();
    }
  });

  it('refuses to mark a PENDING invoice as PAID after its expiresAt elapses', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const service = new InvoiceService(pool);

    try {
      const created = await service.createInvoice(createInput(SELLER_A, { amount: 5, expiresInDays: 1 }));
      await pool.query("UPDATE invoices SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [created.id]);

      await assert.rejects(
        () => service.markAsPaid(created.id, 'b'.repeat(64), PAYER),
        /Invoice not found, expired, or already processed/
      );

      const fetched = await service.getInvoiceById(created.id);
      assert.equal(fetched?.status, 'EXPIRED');
    } finally {
      await pool.end();
    }
  });

  it('refuses double markAsPaid for the same invoice', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const service = new InvoiceService(pool);

    try {
      const created = await service.createInvoice(createInput(SELLER_A, { amount: 33 }));
      await service.markAsPaid(created.id, 'c'.repeat(64), PAYER);

      await assert.rejects(
        () => service.markAsPaid(created.id, 'd'.repeat(64), PAYER),
        /Invoice not found, expired, or already processed/
      );
    } finally {
      await pool.end();
    }
  });

  it('cancels a PENDING invoice exactly once, then rejects second cancel', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const service = new InvoiceService(pool);

    try {
      const created = await service.createInvoice(createInput(SELLER_A, { amount: 12.5 }));
      const cancelled = await service.cancelInvoice(created.id);

      assert.equal(cancelled.status, 'CANCELLED');

      await assert.rejects(
        () => service.cancelInvoice(created.id),
        /Invoice not found or already processed/
      );
    } finally {
      await pool.end();
    }
  });

  it('markExpiredInvoices counts rows and transitions status for lazy reads', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const service = new InvoiceService(pool);

    try {
      const fresh = await service.createInvoice(createInput(SELLER_A, { amount: 99, expiresInDays: 30 }));
      await pool.query("UPDATE invoices SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1 AND status = 'PENDING'", [fresh.id]);

      const count = await service.markExpiredInvoices();
      assert.ok(count >= 1, 'at least the seeded expired row should be marked');

      const read = await service.getInvoiceById(fresh.id);
      assert.equal(read?.status, 'EXPIRED');

      const [stats] = await service.getInvoiceStats(SELLER_A);
      assert.ok(Number(stats.expired_invoices) >= 1);
      assert.equal(Number(stats.pending_invoices) + Number(stats.paid_invoices) + Number(stats.expired_invoices) + Number(stats.actionable_invoices) >= 0, true);
    } finally {
      await pool.end();
    }
  });

  it('PostgresInvoiceStorage adapter exposes the same InvoiceStorage contract as memory', async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const service = new InvoiceService(pool);
    const storage = new PostgresInvoiceStorage(service);

    try {
      assert.equal(storage.mode, 'postgres');

      const created: StoredInvoice = await storage.createInvoice(createInput(SELLER_A, {
        amount: 55,
        sellerName: 'Storage Adapter',
        expiresInDays: 7,
      }));
      assert.ok(created.id);
      assert.equal(created.sellerName, 'Storage Adapter');

      const got = await storage.getInvoiceById(created.id);
      assert.equal(got?.id, created.id);

      const listed = await storage.getInvoicesBySeller(SELLER_A);
      assert.ok(listed.some(i => i.id === created.id));

      const cancelled = await storage.cancelInvoice(created.id);
      assert.equal(cancelled.status, 'CANCELLED');

      const stats = await storage.getInvoiceStats(SELLER_A);
      assert.ok(Array.isArray(stats));
      assert.equal(typeof stats[0].total_invoices, 'number');

      const expiredCount = await storage.markExpiredInvoices();
      assert.equal(typeof expiredCount, 'number');
    } finally {
      await pool.end();
    }
  });

  it('applies seed.sql idempotently without violating invoice memo uniqueness', async () => {
    const seedSql = fs.readFileSync(SEED_PATH, 'utf-8');
    await adminPool.query(seedSql);
    await adminPool.query(seedSql);

    const result = await adminPool.query(
      "SELECT COUNT(*)::int AS c FROM invoices WHERE memo LIKE 'INV-DEMO-%'"
    );
    assert.equal(result.rows[0].c, 4, 'seed rows should be exactly 4 after two runs (ON CONFLICT DO NOTHING)');
  });
});
