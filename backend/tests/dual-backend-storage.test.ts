import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { configuredStorageMode } from '../src/config/runtime';
import { resolveDefaultStorage } from '../src/routes/index';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { PostgresInvoiceStorage } from '../src/storage/postgres-invoice-storage';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { MemoryStorage } from '../src/storage/memory-storage';
import { InvoiceService } from '../src/services/invoice.service';
import type { InvoiceStorage, StoredInvoice } from '../src/storage/invoice-storage';
import type { CreateInvoiceInput } from '../src/utils/validation';

const SELLER_A = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const SELLER_B = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const PAYER = 'GCFXHS4GXL6BVUCXBWXGTITROWLVYXQKQLF4YH5O5JT3YZXW7P3ST2VN';

/**
 * Builds standard input payload for testing invoice creation.
 *
 * @param seller - Seller public key string.
 * @param overrides - Partial input overrides.
 * @returns Complete CreateInvoiceInput object.
 */
function createInput(
  seller: string,
  overrides: Partial<CreateInvoiceInput> = {}
): CreateInvoiceInput {
  return {
    amount: 100,
    assetCode: 'XLM',
    description: 'Contract test invoice',
    sellerPublicKey: seller,
    expiresInDays: 7,
    ...overrides,
  };
}

/**
 * Creates an in-memory SQL database stub that records rows to test Postgres persistence logic.
 *
 * @returns Database connection stub.
 */
function createStubDb() {
  const rows: any[] = [];
  const events: any[] = [];

  function clone<T>(val: T): T {
    return JSON.parse(JSON.stringify(val));
  }

  return {
    rows,
    events,
    async query(rawSql: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
      const sql = rawSql.replace(/\s+/g, ' ').trim();

      if (sql.startsWith('INSERT INTO invoices')) {
        const row = {
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
        events.push({ invoiceId: params[0], eventType: params[1] });
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith('SELECT * FROM invoices WHERE id =')) {
        let found = rows.filter(row => row.id === params[0]);
        if (sql.includes('AND seller_public_key =')) {
          found = found.filter(row => row.seller_public_key === params[1]);
        }
        return { rows: found.map(clone), rowCount: found.length };
      }

      if (sql.startsWith('SELECT * FROM invoices WHERE memo =')) {
        const found = rows.filter(row => row.memo === params[0]);
        return { rows: found.map(clone), rowCount: found.length };
      }

      if (sql.startsWith('SELECT * FROM invoices WHERE seller_public_key =')) {
        let found = rows.filter(row => row.seller_public_key === params[0]);
        if (sql.includes('AND status = $2')) {
          found = found.filter(row => row.status === params[1]);
        }
        const offset = params[params.length - 1];
        const limit = params[params.length - 2];
        const page = found
          .slice()
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
          .slice(offset, offset + limit);
        return { rows: page.map(clone), rowCount: page.length };
      }

      if (sql.startsWith("UPDATE invoices SET status = 'EXPIRED'")) {
        const now = new Date(params[0]).getTime();
        const expired = rows.filter(
          row => row.status === 'PENDING' && new Date(row.expires_at).getTime() <= now
        );
        expired.forEach(row => { row.status = 'EXPIRED'; });
        return { rows: expired.map(row => ({ id: row.id })), rowCount: expired.length };
      }

      if (sql.startsWith("UPDATE invoices SET status = 'PAID'") || sql.startsWith('WITH settled AS')) {
        const settledAt = params[5] ? new Date(params[5]) : new Date();
        const row = rows.find(
          r => r.id === params[0] && (r.status === 'PENDING' || r.status === 'EXPIRED')
        );
        if (!row) {
          return { rows: [], rowCount: 0 };
        }
        const priorStatus = row.status;
        row.status = 'PAID';
        row.payment_tx_hash = params[1];
        row.payer_public_key = params[2];
        row.payer_name = params[3];
        row.payer_email = params[4];
        row.paid_at = settledAt;
        row.settled_at = settledAt;
        row.settlement_context = 'normal';
        row.prior_status = priorStatus;
        return { rows: [clone(row)], rowCount: 1 };
      }

      if (sql.startsWith("UPDATE invoices SET status = 'CANCELLED'")) {
        const row = rows.find(
          r => r.id === params[0] && r.status === 'PENDING' && (!params[1] || r.seller_public_key === params[1])
        );
        if (!row) {
          return { rows: [], rowCount: 0 };
        }
        row.status = 'CANCELLED';
        row.cancelled_at = new Date();
        return { rows: [clone(row)], rowCount: 1 };
      }

      if (sql.includes('as total_invoices') || sql.includes('FROM invoices WHERE seller_public_key = $1')) {
        const sellerRows = rows.filter(r => r.seller_public_key === params[0]);
        const stats = {
          total_invoices: String(sellerRows.length),
          pending_invoices: String(sellerRows.filter(r => r.status === 'PENDING').length),
          paid_invoices: String(sellerRows.filter(r => r.status === 'PAID').length),
          expired_invoices: String(sellerRows.filter(r => r.status === 'EXPIRED').length),
          cancelled_invoices: String(sellerRows.filter(r => r.status === 'CANCELLED').length),
          actionable_invoices: String(sellerRows.filter(r => r.status === 'PENDING').length),
          revenue_by_asset: {},
        };
        return { rows: [stats], rowCount: 1 };
      }

      if (sql.startsWith('SELECT COUNT(*)')) {
        return { rows: [{ count: rows.length }], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

describe('Storage Mode Resolution and Local Demo Default', () => {
  it('defaults to memory mode when DATABASE_URL is unset', () => {
    assert.equal(configuredStorageMode({}), 'memory');
    assert.equal(configuredStorageMode({ DATABASE_URL: '' }), 'memory');
  });

  it('selects postgres mode when DATABASE_URL is present without override flags', () => {
    assert.equal(
      configuredStorageMode({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/quittance' }),
      'postgres'
    );
  });

  it('honors INVOICE_STORAGE override flag over DATABASE_URL', () => {
    assert.equal(
      configuredStorageMode({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/quittance',
        INVOICE_STORAGE: 'memory',
      }),
      'memory'
    );
    assert.equal(
      configuredStorageMode({
        INVOICE_STORAGE: 'postgres',
      }),
      'postgres'
    );
  });

  it('honors STORAGE_MODE override flag over DATABASE_URL', () => {
    assert.equal(
      configuredStorageMode({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/quittance',
        STORAGE_MODE: 'memory',
      }),
      'memory'
    );
    assert.equal(
      configuredStorageMode({
        STORAGE_MODE: 'postgres',
      }),
      'postgres'
    );
  });

  it('resolves default storage to in-memory adapter without database environment', () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalStorage = process.env.INVOICE_STORAGE;
    delete process.env.DATABASE_URL;
    delete process.env.INVOICE_STORAGE;

    try {
      const storage = resolveDefaultStorage();
      assert.equal(storage.mode, 'in-memory');
    } finally {
      if (originalDatabaseUrl !== undefined) process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalStorage !== undefined) process.env.INVOICE_STORAGE = originalStorage;
    }
  });
});

describe('Cross-Seller Read Isolation on Both Backends', () => {
  const backends: Array<{ name: string; createStorage: () => InvoiceStorage }> = [
    {
      name: 'MemoryInvoiceStorage',
      createStorage: () => new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage())),
    },
    {
      name: 'PostgresInvoiceStorage',
      createStorage: () => new PostgresInvoiceStorage(new InvoiceService(createStubDb() as any)),
    },
  ];

  for (const { name, createStorage } of backends) {
    describe(name, () => {
      it('prevents seller B from reading seller A invoices in lists', async () => {
        const storage = createStorage();
        const invoiceA = await storage.createInvoice(createInput(SELLER_A, { amount: 50 }));
        assert.ok(invoiceA.id);

        const sellerBInvoices = await storage.getInvoicesBySeller(SELLER_B);
        assert.equal(sellerBInvoices.length, 0);

        const sellerAInvoices = await storage.getInvoicesBySeller(SELLER_A);
        assert.equal(sellerAInvoices.length, 1);
        assert.equal(sellerAInvoices[0].id, invoiceA.id);
      });

      it('prevents seller B from observing seller A invoice statistics', async () => {
        const storage = createStorage();
        await storage.createInvoice(createInput(SELLER_A, { amount: 150 }));

        const [statsB] = await storage.getInvoiceStats(SELLER_B);
        assert.equal(Number(statsB.total_invoices), 0);

        const [statsA] = await storage.getInvoiceStats(SELLER_A);
        assert.equal(Number(statsA.total_invoices), 1);
      });

      it('prevents seller B from scoping seller A invoice by ID', async () => {
        const storage = createStorage();
        const invoiceA = await storage.createInvoice(createInput(SELLER_A, { amount: 200 }));

        const fetchedAsSellerB = await storage.getInvoiceById(invoiceA.id, SELLER_B);
        assert.equal(fetchedAsSellerB, null);

        const fetchedAsSellerA = await storage.getInvoiceById(invoiceA.id, SELLER_A);
        assert.ok(fetchedAsSellerA);
        assert.equal(fetchedAsSellerA.id, invoiceA.id);
      });

      it('allows public pay ID lookup without seller key for payer flow', async () => {
        const storage = createStorage();
        const invoiceA = await storage.createInvoice(createInput(SELLER_A, { amount: 75 }));

        const publicPayFetch = await storage.getInvoiceById(invoiceA.id);
        assert.ok(publicPayFetch);
        assert.equal(publicPayFetch.id, invoiceA.id);
        assert.equal(publicPayFetch.amount, 75);
      });

      it('rejects cancellation by unauthorized seller', async () => {
        const storage = createStorage();
        const invoiceA = await storage.createInvoice(createInput(SELLER_A, { amount: 80 }));

        await assert.rejects(
          async () => storage.cancelInvoice(invoiceA.id, SELLER_B),
          /unauthorized|only the seller/i
        );

        const cancelledByOwner = await storage.cancelInvoice(invoiceA.id, SELLER_A);
        assert.equal(cancelledByOwner.status, 'CANCELLED');
      });
    });
  }
});

describe('Stability of Public Pay IDs Across Reconnect and Restart', () => {
  it('preserves public invoice ID and attributes across Postgres repository restarts', async () => {
    const persistentDb = createStubDb();
    const serviceBeforeRestart = new InvoiceService(persistentDb as any);
    const storageBeforeRestart = new PostgresInvoiceStorage(serviceBeforeRestart);

    const created: StoredInvoice = await storageBeforeRestart.createInvoice(
      createInput(SELLER_A, {
        amount: 250,
        sellerName: 'Acme Corp',
        customerName: 'Client LLC',
        assetCode: 'USDC',
      })
    );

    const savedId = created.id;
    const savedMemo = created.memo;
    assert.ok(savedId);
    assert.ok(savedMemo);

    const serviceAfterRestart = new InvoiceService(persistentDb as any);
    const storageAfterRestart = new PostgresInvoiceStorage(serviceAfterRestart);

    const fetchedAfterRestart = await storageAfterRestart.getInvoiceById(savedId);
    assert.ok(fetchedAfterRestart);
    assert.equal(fetchedAfterRestart.id, savedId);
    assert.equal(fetchedAfterRestart.memo, savedMemo);
    assert.equal(fetchedAfterRestart.amount, 250);
    assert.equal(fetchedAfterRestart.sellerName, 'Acme Corp');
    assert.equal(fetchedAfterRestart.customerName, 'Client LLC');
    assert.equal(fetchedAfterRestart.assetCode, 'USDC');
    assert.equal(fetchedAfterRestart.status, 'PENDING');

    const paid = await storageAfterRestart.markAsPaid(
      savedId,
      'a'.repeat(64),
      PAYER,
      { name: 'Payer One', email: 'payer@example.com' }
    );
    assert.equal(paid.status, 'PAID');
    assert.equal(paid.paymentTxHash, 'a'.repeat(64));

    const reloaded = await storageAfterRestart.getInvoiceById(savedId);
    assert.ok(reloaded);
    assert.equal(reloaded.id, savedId);
    assert.equal(reloaded.status, 'PAID');
  });
});
