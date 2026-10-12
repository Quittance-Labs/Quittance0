import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import express from 'express';
import type { AddressInfo } from 'node:net';
import {
  runMigrations,
  checkMigrationStatus,
  loadMigrationFiles,
  computeChecksum,
  ensureMigrationTable,
  MIGRATION_LOCK_ID,
  type AppliedMigration,
} from '../src/db/migration-runner.ts';
import { readinessHandler } from '../src/health.ts';
import { deploymentReadinessAsync } from '../src/config/runtime.ts';

interface MockRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

function createMockPostgresDb(initialHasInvoices = false) {
  const migrations: MockRow[] = [];
  let hasInvoices = initialHasInvoices;
  let hasSchemaMigrations = false;
  let lockHeld = false;
  const lockWaiters: Array<() => void> = [];
  const executedSqls: string[] = [];
  const invoicesData: any[] = [];

  const pool = {
    connect: async () => client,
    query: async (sql: string, params: any[] = []) => client.query(sql, params),
  };

  const client = {
    query: async (text: string, params: any[] = []) => {
      const sql = text.replace(/\s+/g, ' ').trim();

      if (sql.includes('pg_advisory_lock')) {
        if (lockHeld) {
          await new Promise<void>((resolve) => lockWaiters.push(resolve));
        }
        lockHeld = true;
        return { rows: [{ pg_advisory_lock: null }], rowCount: 1 };
      }

      if (sql.includes('pg_advisory_unlock')) {
        lockHeld = false;
        const next = lockWaiters.shift();
        if (next) {
          next();
        }
        return { rows: [{ pg_advisory_unlock: true }], rowCount: 1 };
      }

      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        hasSchemaMigrations = true;
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("information_schema.tables") && sql.includes("'schema_migrations'")) {
        return { rows: [{ exists: hasSchemaMigrations }], rowCount: 1 };
      }

      if (sql.includes("information_schema.tables") && sql.includes("'invoices'")) {
        return { rows: [{ exists: hasInvoices }], rowCount: 1 };
      }

      if (sql.includes('SELECT version, name, checksum, applied_at FROM schema_migrations')) {
        if (!hasSchemaMigrations) {
          throw new Error('relation "schema_migrations" does not exist');
        }
        return { rows: [...migrations], rowCount: migrations.length };
      }

      if (sql.startsWith('INSERT INTO schema_migrations')) {
        const [version, name, checksum] = params;
        if (migrations.some((m) => m.version === version)) {
          throw new Error(`duplicate key value violates unique constraint "schema_migrations_pkey"`);
        }
        migrations.push({
          version: String(version),
          name: String(name),
          checksum: String(checksum),
          applied_at: new Date(),
        });
        return { rows: [], rowCount: 1 };
      }

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }

      // Track general migration execution
      executedSqls.push(sql);
      if (sql.includes('CREATE TABLE IF NOT EXISTS invoices') || sql.includes('CREATE TABLE invoices')) {
        hasInvoices = true;
      }

      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };

  return {
    pool,
    client,
    migrations,
    getHasInvoices: () => hasInvoices,
    setHasInvoices: (val: boolean) => {
      hasInvoices = val;
    },
    invoicesData,
    executedSqls,
    isLockHeld: () => lockHeld,
  };
}

describe('Database Migration Runner (#583)', () => {
  let tempMigrationsDir: string;

  beforeEach(() => {
    tempMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quittance-migrations-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempMigrationsDir)) {
      fs.rmSync(tempMigrationsDir, { recursive: true, force: true });
    }
  });

  it('runs migrations on an empty database and the second run applies nothing', async () => {
    // Setup two migration files
    const m1Path = path.join(tempMigrationsDir, '0001_baseline.sql');
    const m2Path = path.join(tempMigrationsDir, '0002_add_checks.sql');
    fs.writeFileSync(m1Path, 'CREATE TABLE IF NOT EXISTS invoices (id uuid primary key);');
    fs.writeFileSync(m2Path, 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status text;');

    const db = createMockPostgresDb(false);

    // Run 1: Should apply both 0001 and 0002
    const run1 = await runMigrations(db.pool as any, { migrationsDir: tempMigrationsDir });
    assert.equal(run1.applied.length, 2);
    assert.equal(run1.applied[0].version, '0001');
    assert.equal(run1.applied[1].version, '0002');
    assert.equal(run1.adopted.length, 0);
    assert.equal(run1.latestVersion, '0002');
    assert.equal(db.migrations.length, 2);

    // Run 2: Should apply nothing (idempotency check)
    const run2 = await runMigrations(db.pool as any, { migrationsDir: tempMigrationsDir });
    assert.equal(run2.applied.length, 0);
    assert.equal(run2.adopted.length, 0);
    assert.equal(run2.latestVersion, '0002');
    assert.equal(db.migrations.length, 2);
  });

  it('adopts baseline 0001 on an existing database built from legacy schema without replaying it', async () => {
    // Setup two migration files
    const m1Path = path.join(tempMigrationsDir, '0001_baseline.sql');
    const m2Path = path.join(tempMigrationsDir, '0002_align_constraints.sql');
    fs.writeFileSync(m1Path, 'CREATE TABLE invoices (id uuid primary key);');
    fs.writeFileSync(m2Path, 'ALTER TABLE invoices ADD COLUMN status text;');

    // Existing database already has invoices table, but no schema_migrations
    const db = createMockPostgresDb(true);

    const result = await runMigrations(db.pool as any, { migrationsDir: tempMigrationsDir });

    // Baseline 0001 should be adopted, 0002 should be applied
    assert.equal(result.adopted.length, 1);
    assert.equal(result.adopted[0].version, '0001');
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].version, '0002');

    // 0001 SQL should NOT have been executed
    assert.equal(db.executedSqls.some((sql) => sql.includes('CREATE TABLE invoices')), false);
    // 0002 SQL should have been executed
    assert.equal(db.executedSqls.some((sql) => sql.includes('ALTER TABLE invoices ADD COLUMN status text')), true);
    // schema_migrations should contain both
    assert.equal(db.migrations.length, 2);
    assert.equal(db.migrations[0].version, '0001');
    assert.equal(db.migrations[1].version, '0002');
  });

  it('two concurrent runs under advisory lock never apply the same version twice', async () => {
    const m1Path = path.join(tempMigrationsDir, '0001_baseline.sql');
    fs.writeFileSync(m1Path, 'CREATE TABLE IF NOT EXISTS invoices (id uuid primary key);');

    const db = createMockPostgresDb(false);

    // Run two migration runners concurrently
    const [res1, res2] = await Promise.all([
      runMigrations(db.pool as any, { migrationsDir: tempMigrationsDir }),
      runMigrations(db.pool as any, { migrationsDir: tempMigrationsDir }),
    ]);

    const totalApplied = res1.applied.length + res2.applied.length;
    assert.equal(totalApplied, 1, 'Migration 0001 should only be applied once across concurrent runs');
    assert.equal(db.migrations.length, 1);
  });

  it('fails with a checksum error if an already-applied migration file is modified', async () => {
    const m1Path = path.join(tempMigrationsDir, '0001_baseline.sql');
    fs.writeFileSync(m1Path, 'CREATE TABLE invoices (id uuid);');

    const db = createMockPostgresDb(false);
    await runMigrations(db.pool as any, { migrationsDir: tempMigrationsDir });

    // Now tamper with the migration file
    fs.writeFileSync(m1Path, 'CREATE TABLE invoices (id uuid, tampered text);');

    await assert.rejects(
      () => runMigrations(db.pool as any, { migrationsDir: tempMigrationsDir }),
      (err: any) => {
        assert.match(err.message, /Migration checksum mismatch for version 0001/);
        return true;
      }
    );
  });

  it('checkMigrationStatus correctly reports readiness', async () => {
    const m1Path = path.join(tempMigrationsDir, '0001_baseline.sql');
    const m2Path = path.join(tempMigrationsDir, '0002_more.sql');
    fs.writeFileSync(m1Path, 'SELECT 1;');
    fs.writeFileSync(m2Path, 'SELECT 2;');

    const db = createMockPostgresDb(false);

    // Initial state: not ready, both migrations pending
    const statusBefore = await checkMigrationStatus(db.pool as any, { migrationsDir: tempMigrationsDir });
    assert.equal(statusBefore.ready, false);
    assert.deepEqual(statusBefore.pendingVersions, ['0001', '0002']);

    // Run migrations
    await runMigrations(db.pool as any, { migrationsDir: tempMigrationsDir });

    // After migration: ready, 0 pending
    const statusAfter = await checkMigrationStatus(db.pool as any, { migrationsDir: tempMigrationsDir });
    assert.equal(statusAfter.ready, true);
    assert.equal(statusAfter.latestAppliedVersion, '0002');
    assert.equal(statusAfter.latestBundledVersion, '0002');
    assert.deepEqual(statusAfter.pendingVersions, []);
  });

  it('readiness check fails (HTTP 503) when database migrations are pending in postgres mode', async () => {
    const m1Path = path.join(tempMigrationsDir, '0001_baseline.sql');
    fs.writeFileSync(m1Path, 'SELECT 1;');

    const db = createMockPostgresDb(false);

    // Test deploymentReadinessAsync directly with unmigrated database
    const readinessUnmigrated = await deploymentReadinessAsync(
      {
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://quittance.example.com',
        STELLAR_NETWORK: 'TESTNET',
        STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
        ALLOW_SIMULATE: 'false',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        INVOICE_STORAGE: 'postgres',
      },
      {
        storage: 'postgres',
        pool: db.pool,
        migrationsDir: tempMigrationsDir,
      }
    );

    assert.equal(readinessUnmigrated.ready, false);
    assert.equal(readinessUnmigrated.checks.storageReady, false);
    assert.ok(readinessUnmigrated.reasons.some((r) => r.includes('Database schema is not up to date')));

    // Test through HTTP express probe
    const app = express();
    app.get('/api/ready', async (req, res) => {
      const result = await deploymentReadinessAsync(
        {
          NODE_ENV: 'production',
          FRONTEND_URL: 'https://quittance.example.com',
          STELLAR_NETWORK: 'TESTNET',
          STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
          ALLOW_SIMULATE: 'false',
          DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
          INVOICE_STORAGE: 'postgres',
        },
        {
          storage: 'postgres',
          pool: db.pool,
          migrationsDir: tempMigrationsDir,
        }
      );
      res.status(result.ready ? 200 : 503).json(result);
    });

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ready`);
      assert.equal(res.status, 503);
      const json = (await res.json()) as any;
      assert.equal(json.ready, false);
      assert.equal(json.checks.storageReady, false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Now migrate the database
    await runMigrations(db.pool as any, { migrationsDir: tempMigrationsDir });

    // Readiness check should now succeed (HTTP 200)
    const readinessMigrated = await deploymentReadinessAsync(
      {
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://quittance.example.com',
        STELLAR_NETWORK: 'TESTNET',
        STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
        ALLOW_SIMULATE: 'false',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        INVOICE_STORAGE: 'postgres',
      },
      {
        storage: 'postgres',
        pool: db.pool,
        migrationsDir: tempMigrationsDir,
      }
    );

    assert.equal(readinessMigrated.ready, true);
    assert.equal(readinessMigrated.checks.storageReady, true);
  });
});
