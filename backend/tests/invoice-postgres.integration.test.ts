// Integration test against a real Postgres database.
//
// Skipped unless DATABASE_URL points at a disposable database:
//   DATABASE_URL=postgresql://user:password@localhost:5432/quittance_test npm test
//
// It applies db/schema.sql, then checks that invoices survive a fresh
// connection (the restart case) and that one seller never sees another's rows.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { Keypair } from '@stellar/stellar-sdk';
import { InvoiceService } from '../src/services/invoice.service.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const SCHEMA_PATH = path.join(__dirname, '../../db/schema.sql');

const SELLER_A = Keypair.random().publicKey();
const SELLER_B = Keypair.random().publicKey();

describe('Invoice persistence on Postgres', { skip: DATABASE_URL ? false : 'DATABASE_URL is not set' }, () => {
  let adminPool: Pool;

  before(async () => {
    adminPool = new Pool({ connectionString: DATABASE_URL });
    await adminPool.query(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  });

  after(async () => {
    await adminPool.query('DELETE FROM invoices WHERE seller_public_key = ANY($1)', [[SELLER_A, SELLER_B]]);
    await adminPool.end();
  });

  it('keeps seller A invoices for a new connection and hides them from seller B', async () => {
    const writePool = new Pool({ connectionString: DATABASE_URL });
    const created = await new InvoiceService(writePool).createInvoice({
      amount: 42.5,
      sellerPublicKey: SELLER_A,
      description: 'Integration test invoice',
    } as any);
    // Closing the pool stands in for a backend restart.
    await writePool.end();

    const readPool = new Pool({ connectionString: DATABASE_URL });
    const service = new InvoiceService(readPool);

    try {
      const sellerAInvoices = await service.getInvoicesBySeller(SELLER_A);
      assert.equal(sellerAInvoices.length, 1);
      assert.equal(sellerAInvoices[0].id, created.id);
      assert.equal(sellerAInvoices[0].sellerPublicKey, SELLER_A);

      const sellerBInvoices = await service.getInvoicesBySeller(SELLER_B);
      assert.deepEqual(sellerBInvoices, []);

      const [statsA] = await service.getInvoiceStats(SELLER_A);
      assert.equal(Number(statsA.total_invoices), 1);
      assert.equal(Number(statsA.pending_invoices), 1);

      const [statsB] = await service.getInvoiceStats(SELLER_B);
      assert.equal(Number(statsB.total_invoices), 0);
    } finally {
      await readPool.end();
    }
  });
});
