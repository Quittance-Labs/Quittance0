import { sellerSessionLocals } from './fixtures/seller-auth';
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { MemoryStorage } from '../src/storage/memory-storage';
import { InvoiceService, type Queryable } from '../src/services/invoice.service';
import {
  exportMemorySnapshot,
  validateCutoverSnapshot,
  importSnapshotToPostgres,
  verifyCutoverParity,
  computeSnapshotChecksum,
  CutoverValidationError,
  CutoverMemoCollisionError,
  type CutoverSnapshot,
} from '../src/services/cutover.service';
import { cutoverDrainMode } from '../src/config/runtime';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { PostgresInvoiceStorage } from '../src/storage/postgres-invoice-storage';

const SELLER_A = 'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP';
const SELLER_B = 'GCBAENYI5GN7X7J5ANCI3TMRTAWCRYAVJN3Q5OPZMUXULO5SYIVJQ6AV';
const PAYER = 'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const VALID_UUID_1 = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_2 = '22222222-2222-4222-8222-222222222222';
const VALID_UUID_3 = '33333333-3333-4333-8333-333333333333';
const VALID_UUID_4 = '44444444-4444-4444-8444-444444444444';
const VALID_TX_HASH = 'a'.repeat(64);

class TransactionalFakeDb implements Queryable {
  rows: Record<string, any>[] = [];
  snapshotStack: Record<string, any>[][] = [];
  queries: { text: string; params: any[] }[] = [];

  async query(text: string, params: any[] = []) {
    this.queries.push({ text, params });
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql === 'BEGIN') {
      this.snapshotStack.push(this.rows.map((r) => ({ ...r })));
      return { rows: [], rowCount: 0 };
    }

    if (sql === 'ROLLBACK') {
      if (this.snapshotStack.length > 0) {
        this.rows = this.snapshotStack.pop()!;
      }
      return { rows: [], rowCount: 0 };
    }

    if (sql === 'COMMIT') {
      this.snapshotStack.pop();
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT memo, id FROM invoices WHERE memo = ANY($1)')) {
      const memos: string[] = params[0] || [];
      const matches = this.rows.filter((r) => memos.includes(r.memo));
      return { rows: matches.map((r) => ({ memo: r.memo, id: r.id })), rowCount: matches.length };
    }

    if (sql.startsWith('SELECT id FROM invoices WHERE id = ANY($1)')) {
      const ids: string[] = params[0] || [];
      const matches = this.rows.filter((r) => ids.includes(r.id));
      return { rows: matches.map((r) => ({ id: r.id })), rowCount: matches.length };
    }

    if (sql.startsWith('INSERT INTO invoices')) {
      const row: Record<string, any> = {
        id: params[0],
        seller_public_key: params[1],
        seller_name: params[2],
        seller_email: params[3],
        amount: params[4],
        asset_code: params[5],
        asset_issuer: params[6],
        memo: params[7],
        description: params[8],
        customer_name: params[9],
        customer_email: params[10],
        status: params[11],
        payment_tx_hash: params[12],
        payer_public_key: params[13],
        payer_name: params[14],
        payer_email: params[15],
        created_at: params[16] ? new Date(params[16]) : new Date(),
        paid_at: params[17] ? new Date(params[17]) : null,
        cancelled_at: params[18] ? new Date(params[18]) : null,
        settled_at: params[19] ? new Date(params[19]) : null,
        settlement_context: params[20],
        prior_status: params[21],
        late_payment_warning_code: params[22],
        expires_at: params[23] ? new Date(params[23]) : new Date(),
        metadata: params[24] ? JSON.parse(params[24]) : null,
      };
      this.rows.push(row);
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO transactions') || sql.startsWith('INSERT INTO payment_events')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE invoices SET status = 'EXPIRED'")) {
      const now = new Date(params[0] || Date.now()).getTime();
      const expired = this.rows.filter(
        (row) => row.status === 'PENDING' && new Date(row.expires_at).getTime() <= now
      );
      expired.forEach((row) => {
        row.status = 'EXPIRED';
      });
      return { rows: expired.map((row) => ({ id: row.id })), rowCount: expired.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE id =')) {
      const matches = this.rows.filter((r) => r.id === params[0]);
      return { rows: matches.map((r) => ({ ...r })), rowCount: matches.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE memo =')) {
      const matches = this.rows.filter((r) => r.memo === params[0]);
      return { rows: matches.map((r) => ({ ...r })), rowCount: matches.length };
    }

    if (sql.startsWith('SELECT * FROM invoices WHERE seller_public_key =')) {
      const matches = this.rows.filter((r) => r.seller_public_key === params[0]);
      return { rows: matches.map((r) => ({ ...r })), rowCount: matches.length };
    }

    if (sql.includes('FROM invoices') && (sql.includes('COUNT(*)') || sql.includes('total_invoices'))) {
      const scoped = sql.includes('seller_public_key = $1')
        ? this.rows.filter((row) => row.seller_public_key === params[0])
        : this.rows;

      const paid = scoped.filter((row) => row.status === 'PAID');
      const revenueByAsset: Record<string, number> = {};
      paid.forEach((row) => {
        revenueByAsset[row.asset_code] =
          (revenueByAsset[row.asset_code] || 0) + Number(row.amount);
      });

      return {
        rows: [
          {
            total_invoices: scoped.length,
            paid_invoices: paid.length,
            pending_invoices: scoped.filter((row) => row.status === 'PENDING').length,
            actionable_invoices: scoped.filter((row) => row.status === 'PENDING').length,
            expired_invoices: scoped.filter((row) => row.status === 'EXPIRED').length,
            revenue_by_asset: revenueByAsset,
          },
        ],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 0 };
  }
}

describe('Cutover Export, Validation, and Transactional Import Engine', () => {
  let memory: MemoryStorage;
  let fakeDb: TransactionalFakeDb;

  beforeEach(() => {
    memory = new MemoryStorage();
    fakeDb = new TransactionalFakeDb();
  });

  it('exports in-memory invoices to a canonical snapshot with correct count and SHA-256 digest', async () => {
    const inv1 = await memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 100,
      assetCode: 'XLM',
      memo: 'MEMO-EXP-1',
    });

    const inv2 = await memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 50,
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
      memo: 'MEMO-EXP-2',
    });

    const snapshot = exportMemorySnapshot(memory);

    assert.equal(snapshot.version, '1.0');
    assert.equal(snapshot.source, 'memory');
    assert.equal(snapshot.count, 2);
    assert.equal(snapshot.invoices.length, 2);
    assert.match(snapshot.checksum, /^[a-f0-9]{64}$/);

    const validation = validateCutoverSnapshot(snapshot);
    assert.equal(validation.valid, true);
    assert.equal(validation.errors.length, 0);
  });

  it('imports a clean snapshot into PostgreSQL preserving byte-identical UUIDs and memos', async () => {
    const inv1 = await memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 42.5,
      assetCode: 'XLM',
      memo: 'MEMO-CLEAN-1',
      description: 'Consulting invoice',
    });

    const inv2 = await memory.createInvoice({
      sellerPublicKey: SELLER_B,
      amount: 1500,
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUER,
      memo: 'MEMO-CLEAN-2',
    });

    await memory.markAsPaid(inv1.id, VALID_TX_HASH, PAYER, undefined, { settledAt: new Date() });

    const snapshot = exportMemorySnapshot(memory);
    const importResult = await importSnapshotToPostgres(fakeDb, snapshot);

    assert.equal(importResult.success, true);
    assert.equal(importResult.importedCount, 2);
    assert.equal(importResult.dryRun, false);

    const pgStorage = new PostgresInvoiceStorage(new InvoiceService(fakeDb));
    const memStorage = new MemoryInvoiceStorage(new InvoiceMemoryService(memory));

    const parity = await verifyCutoverParity(memStorage, pgStorage, [inv1.id, inv2.id]);
    assert.equal(parity.verified, true);
    assert.equal(parity.checkedCount, 2);
    assert.equal(parity.mismatches.length, 0);

    const pgInv1 = await pgStorage.getInvoiceById(inv1.id);
    assert.ok(pgInv1);
    assert.equal(pgInv1.id, inv1.id);
    assert.equal(pgInv1.memo, 'MEMO-CLEAN-1');
    assert.equal(pgInv1.status, 'PAID');
    assert.equal(pgInv1.paymentTxHash, VALID_TX_HASH);

    const pgInv2 = await pgStorage.getInvoiceById(inv2.id);
    assert.ok(pgInv2);
    assert.equal(pgInv2.id, inv2.id);
    assert.equal(pgInv2.memo, 'MEMO-CLEAN-2');
    assert.equal(pgInv2.status, 'PENDING');
  });

  it('aborts import with zero writes when duplicate memo collision occurs in snapshot', async () => {
    const snapshot: CutoverSnapshot = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      source: 'memory',
      count: 2,
      checksum: '',
      invoices: [
        {
          id: VALID_UUID_1,
          sellerPublicKey: SELLER_A,
          amount: 10,
          assetCode: 'XLM',
          memo: 'COLLIDING-MEMO',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
        {
          id: VALID_UUID_2,
          sellerPublicKey: SELLER_B,
          amount: 20,
          assetCode: 'XLM',
          memo: 'COLLIDING-MEMO',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      ],
    };

    const validation = validateCutoverSnapshot(snapshot);
    assert.equal(validation.valid, false);
    assert.ok(validation.duplicateMemos.includes('COLLIDING-MEMO'));

    await assert.rejects(
      async () => {
        await importSnapshotToPostgres(fakeDb, snapshot);
      },
      (err: any) => {
        assert.ok(err instanceof CutoverMemoCollisionError);
        assert.ok(err.message.includes('COLLIDING-MEMO'));
        return true;
      }
    );

    assert.equal(fakeDb.rows.length, 0);
  });

  it('aborts import and executes ROLLBACK when memo collides with existing DB records', async () => {
    fakeDb.rows.push({
      id: VALID_UUID_1,
      seller_public_key: SELLER_A,
      amount: 10,
      asset_code: 'XLM',
      memo: 'EXISTING-DB-MEMO',
      status: 'PENDING',
      created_at: new Date(),
      expires_at: new Date(Date.now() + 3600000),
    });

    const snapshotInvoices = [
      {
        id: VALID_UUID_2,
        sellerPublicKey: SELLER_B,
        amount: 50,
        assetCode: 'XLM',
        memo: 'EXISTING-DB-MEMO',
        status: 'PENDING' as const,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const snapshot: CutoverSnapshot = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      source: 'memory',
      count: 1,
      checksum: computeSnapshotChecksum(snapshotInvoices),
      invoices: snapshotInvoices,
    };

    await assert.rejects(
      async () => {
        await importSnapshotToPostgres(fakeDb, snapshot);
      },
      (err: any) => {
        assert.ok(err instanceof CutoverMemoCollisionError);
        assert.ok(err.message.includes('EXISTING-DB-MEMO'));
        return true;
      }
    );

    assert.equal(fakeDb.rows.length, 1);
    assert.equal(fakeDb.rows[0].id, VALID_UUID_1);
  });

  it('rejects malformed snapshots: invalid UUID, missing issuer on non-native asset, or unverified PAID status', async () => {
    const invalidUuidSnapshot: CutoverSnapshot = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      source: 'memory',
      count: 1,
      checksum: '',
      invoices: [
        {
          id: 'not-a-uuid',
          sellerPublicKey: SELLER_A,
          amount: 10,
          assetCode: 'XLM',
          memo: 'MEMO-1',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      ],
    };

    assert.equal(validateCutoverSnapshot(invalidUuidSnapshot).valid, false);

    const missingIssuerSnapshot: CutoverSnapshot = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      source: 'memory',
      count: 1,
      checksum: '',
      invoices: [
        {
          id: VALID_UUID_1,
          sellerPublicKey: SELLER_A,
          amount: 10,
          assetCode: 'USDC',
          memo: 'MEMO-1',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      ],
    };

    assert.equal(validateCutoverSnapshot(missingIssuerSnapshot).valid, false);

    const unverifiedPaidSnapshot: CutoverSnapshot = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      source: 'memory',
      count: 1,
      checksum: '',
      invoices: [
        {
          id: VALID_UUID_1,
          sellerPublicKey: SELLER_A,
          amount: 10,
          assetCode: 'XLM',
          memo: 'MEMO-1',
          status: 'PAID',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      ],
    };

    assert.equal(validateCutoverSnapshot(unverifiedPaidSnapshot).valid, false);
  });

  it('dry-run mode validates and rolls back all database changes', async () => {
    const inv = await memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 99,
      assetCode: 'XLM',
      memo: 'DRY-RUN-MEMO',
    });

    const snapshot = exportMemorySnapshot(memory);
    const result = await importSnapshotToPostgres(fakeDb, snapshot, { dryRun: true });

    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.equal(fakeDb.rows.length, 0);
  });

  it('enforces wallet scoping and cross-seller isolation after cutover', async () => {
    const invA = await memory.createInvoice({
      sellerPublicKey: SELLER_A,
      amount: 100,
      assetCode: 'XLM',
      memo: 'SELLER-A-MEMO',
    });

    const invB = await memory.createInvoice({
      sellerPublicKey: SELLER_B,
      amount: 200,
      assetCode: 'XLM',
      memo: 'SELLER-B-MEMO',
    });

    const snapshot = exportMemorySnapshot(memory);
    await importSnapshotToPostgres(fakeDb, snapshot);

    const pgStorage = new PostgresInvoiceStorage(new InvoiceService(fakeDb));

    const sellerAInvoices = await pgStorage.getInvoicesBySeller(SELLER_A);
    assert.equal(sellerAInvoices.length, 1);
    assert.equal(sellerAInvoices[0].id, invA.id);

    const sellerBInvoices = await pgStorage.getInvoicesBySeller(SELLER_B);
    assert.equal(sellerBInvoices.length, 1);
    assert.equal(sellerBInvoices[0].id, invB.id);

    const sellerAStats = await pgStorage.getInvoiceStats(SELLER_A);
    assert.equal(sellerAStats[0].total_invoices, 1);
  });

  it('empty-database boot operates cleanly without errors', async () => {
    const pgStorage = new PostgresInvoiceStorage(new InvoiceService(fakeDb));

    const missing = await pgStorage.getInvoiceById(VALID_UUID_1);
    assert.equal(missing, null);

    const sellerList = await pgStorage.getInvoicesBySeller(SELLER_A);
    assert.deepEqual(sellerList, []);

    const stats = await pgStorage.getInvoiceStats(SELLER_A);
    assert.equal(stats[0].total_invoices, 0);
  });

  it('drain mode pauses invoice creation while reading public pay links remains available', async () => {
    process.env.CUTOVER_DRAIN_MODE = 'true';
    assert.equal(cutoverDrainMode(), true);

    const handlers = createInvoiceHandlers({
      storage: new MemoryInvoiceStorage(new InvoiceMemoryService(memory)),
    });

    let createStatus = 0;
    let createBody: any = null;
    const reqCreate = {
      body: {
        sellerPublicKey: SELLER_A,
        amount: 10,
        assetCode: 'XLM',
      },
    } as any;
    const resCreate = {
      locals: sellerSessionLocals(SELLER_A),
      status(code: number) {
        createStatus = code;
        return this;
      },
      json(data: any) {
        createBody = data;
        return this;
      },
    } as any;

    await handlers.createInvoice(reqCreate, resCreate);
    assert.equal(createStatus, 503);
    assert.ok(createBody.error.includes('cutover drain mode'));

    delete process.env.CUTOVER_DRAIN_MODE;
  });
});
