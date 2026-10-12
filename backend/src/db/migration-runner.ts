import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Pool, PoolClient } from 'pg';

export const MIGRATION_LOCK_ID = 742918451;
export const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../../../db/migrations');

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  filePath: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

export interface MigrationResult {
  applied: Array<{ version: string; name: string }>;
  adopted: Array<{ version: string; name: string }>;
  latestVersion: string | null;
}

export interface MigrationStatus {
  ready: boolean;
  latestAppliedVersion: string | null;
  latestBundledVersion: string | null;
  pendingVersions: string[];
}

export interface MigrationOptions {
  migrationsDir?: string;
}

export function computeChecksum(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function loadMigrationFiles(migrationsDir: string = DEFAULT_MIGRATIONS_DIR): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const migrationFiles: MigrationFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) {
      continue;
    }

    const match = /^(\d+)_([a-zA-Z0-9_\-]+)\.sql$/.exec(entry.name);
    if (!match) {
      continue;
    }

    const [, version, name] = match;
    const filePath = path.join(migrationsDir, entry.name);
    const sql = fs.readFileSync(filePath, 'utf8');
    const checksum = computeChecksum(sql);

    migrationFiles.push({
      version,
      name,
      filename: entry.name,
      filePath,
      sql,
      checksum,
    });
  }

  return migrationFiles.sort((a, b) =>
    a.version.localeCompare(b.version, undefined, { numeric: true })
  );
}

export async function ensureMigrationTable(client: PoolClient | Pool): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Execute all pending migrations in forward-only order.
 *
 * Each migration runs in its own transaction under a global advisory lock.
 * If a database built from the legacy schema is detected, baseline migration 0001
 * is adopted without replaying. If any previously applied migration's checksum has
 * changed, execution aborts with a checksum error.
 */
export async function runMigrations(
  poolOrClient: Pool | PoolClient,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const files = loadMigrationFiles(migrationsDir);

  const isPool = 'connect' in poolOrClient && typeof (poolOrClient as Pool).connect === 'function';
  const client: PoolClient = isPool
    ? await (poolOrClient as Pool).connect()
    : (poolOrClient as PoolClient);

  try {
    // Acquire exclusive advisory lock for migration execution
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

    try {
      await ensureMigrationTable(client);

      const appliedRes = await client.query<AppliedMigration>(`
        SELECT version, name, checksum, applied_at
        FROM schema_migrations
        ORDER BY version ASC
      `);
      const appliedMap = new Map<string, AppliedMigration>(
        appliedRes.rows.map((row) => [row.version, row])
      );

      // Verify checksums of all already applied migrations
      for (const file of files) {
        const applied = appliedMap.get(file.version);
        if (applied && applied.checksum !== file.checksum) {
          throw new Error(
            `Migration checksum mismatch for version ${file.version} (${file.name}): database has ${applied.checksum}, file has ${file.checksum}`
          );
        }
      }

      const applied: Array<{ version: string; name: string }> = [];
      const adopted: Array<{ version: string; name: string }> = [];

      // Check baseline adoption for 0001 on existing legacy databases
      const baseline0001 = files.find((f) => f.version === '0001');
      if (baseline0001 && !appliedMap.has('0001')) {
        const checkInvoicesTable = await client.query<{ exists: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'invoices'
          ) AS exists
        `);

        if (checkInvoicesTable.rows[0]?.exists) {
          await client.query(
            `INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES ($1, $2, $3, NOW())`,
            [baseline0001.version, baseline0001.name, baseline0001.checksum]
          );
          adopted.push({ version: baseline0001.version, name: baseline0001.name });
          appliedMap.set('0001', {
            version: baseline0001.version,
            name: baseline0001.name,
            checksum: baseline0001.checksum,
            applied_at: new Date(),
          });
        }
      }

      // Apply remaining pending migrations in sequence
      for (const file of files) {
        if (appliedMap.has(file.version)) {
          continue;
        }

        await client.query('BEGIN');
        try {
          await client.query(file.sql);
          await client.query(
            `INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES ($1, $2, $3, NOW())`,
            [file.version, file.name, file.checksum]
          );
          await client.query('COMMIT');
          applied.push({ version: file.version, name: file.name });
          appliedMap.set(file.version, {
            version: file.version,
            name: file.name,
            checksum: file.checksum,
            applied_at: new Date(),
          });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      const latestVersion =
        files.length > 0 ? files[files.length - 1].version : null;

      return { applied, adopted, latestVersion };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    }
  } finally {
    if (isPool) {
      client.release();
    }
  }
}

/**
 * Check if the database has applied all bundled migrations.
 */
export async function checkMigrationStatus(
  poolOrClient: Pool | PoolClient,
  options: MigrationOptions = {}
): Promise<MigrationStatus> {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const files = loadMigrationFiles(migrationsDir);

  if (files.length === 0) {
    return {
      ready: true,
      latestAppliedVersion: null,
      latestBundledVersion: null,
      pendingVersions: [],
    };
  }

  const latestBundledVersion = files[files.length - 1].version;

  try {
    const tableCheck = await poolOrClient.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'schema_migrations'
      ) AS exists
    `);

    if (!tableCheck.rows[0]?.exists) {
      return {
        ready: false,
        latestAppliedVersion: null,
        latestBundledVersion,
        pendingVersions: files.map((f) => f.version),
      };
    }

    const appliedRes = await poolOrClient.query<AppliedMigration>(`
      SELECT version, name, checksum, applied_at
      FROM schema_migrations
      ORDER BY version ASC
    `);

    const appliedSet = new Set(appliedRes.rows.map((r) => r.version));
    const pendingVersions = files
      .map((f) => f.version)
      .filter((v) => !appliedSet.has(v));

    const latestAppliedVersion =
      appliedRes.rows.length > 0
        ? appliedRes.rows[appliedRes.rows.length - 1].version
        : null;

    const ready =
      pendingVersions.length === 0 &&
      latestAppliedVersion === latestBundledVersion;

    return {
      ready,
      latestAppliedVersion,
      latestBundledVersion,
      pendingVersions,
    };
  } catch {
    return {
      ready: false,
      latestAppliedVersion: null,
      latestBundledVersion,
      pendingVersions: files.map((f) => f.version),
    };
  }
}
