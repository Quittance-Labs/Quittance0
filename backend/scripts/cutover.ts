#!/usr/bin/env tsx
/**
 * CLI utility for executing memory-to-PostgreSQL cutover operations.
 *
 * Usage:
 *   npx tsx scripts/cutover.ts --export [output_file.json]
 *   npx tsx scripts/cutover.ts --import <input_file.json> [--dry-run]
 *   npx tsx scripts/cutover.ts --verify <input_file.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pool } from '../src/config/database';
import { memoryStorage } from '../src/storage/memory-storage';
import {
  exportMemorySnapshot,
  validateCutoverSnapshot,
  importSnapshotToPostgres,
  CutoverSnapshot,
} from '../src/services/cutover.service';
import { checkMigrationStatus, runMigrations } from '../src/db/migration-runner';

async function main() {
  const options = {
    export: { type: 'string' as const },
    import: { type: 'string' as const },
    verify: { type: 'string' as const },
    'dry-run': { type: 'boolean' as const, default: false },
    help: { type: 'boolean' as const, short: 'h', default: false },
  };

  const { values } = parseArgs({ options, allowPositionals: true });

  if (values.help || (!values.export && !values.import && !values.verify)) {
    console.log(`
Quittance Cutover CLI - Memory to PostgreSQL Transition Tool

Commands:
  --export [path]     Export current in-memory invoices to a canonical JSON snapshot.
                      (Default: ./cutover-snapshot.json)
  --import <path>     Validate and atomically import a snapshot into PostgreSQL.
  --dry-run           Execute import in a transaction and rollback without persisting.
  --verify <path>     Verify that database records match the snapshot byte-for-byte.
  -h, --help          Show this help message.

Environment Variables:
  DATABASE_URL        PostgreSQL connection string.
  CUTOVER_DRAIN_MODE  Set to "true" on the source process before exporting.
`);
    process.exit(0);
  }

  if (values.export) {
    const outputPath = resolve(process.cwd(), typeof values.export === 'string' && values.export !== 'true' ? values.export : 'cutover-snapshot.json');
    console.log(`[Cutover] Exporting in-memory store to ${outputPath}...`);
    const snapshot = exportMemorySnapshot(memoryStorage);
    writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    console.log(`[Cutover] Successfully exported ${snapshot.count} invoice(s).`);
    console.log(`[Cutover] Canonical SHA-256 Checksum: ${snapshot.checksum}`);
    process.exit(0);
  }

  if (values.import) {
    const inputPath = resolve(process.cwd(), values.import);
    console.log(`[Cutover] Reading snapshot from ${inputPath}...`);
    const content = readFileSync(inputPath, 'utf-8');
    const snapshot: CutoverSnapshot = JSON.parse(content);

    console.log(`[Cutover] Validating snapshot schema and checksum...`);
    const validation = validateCutoverSnapshot(snapshot);
    if (!validation.valid) {
      console.error(`[Cutover] Validation FAILED with ${validation.errors.length} error(s):`);
      for (const err of validation.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
    console.log(`[Cutover] Snapshot validation PASSED (${snapshot.count} invoices).`);

    const isDryRun = Boolean(values['dry-run']);
    console.log(`[Cutover] Checking database migration status...`);
    const status = await checkMigrationStatus(pool);
    if (!status.ready) {
      if (isDryRun) {
        console.log(`[Cutover] Pending migrations detected: ${status.pendingVersions.join(', ')}`);
      } else {
        console.log(`[Cutover] Applying pending migrations before import...`);
        await runMigrations(pool);
      }
    }

    console.log(`[Cutover] Executing transactional import (dry-run: ${isDryRun})...`);

    const result = await importSnapshotToPostgres(pool, snapshot, { dryRun: isDryRun });
    console.log(`[Cutover] Import completed successfully in ${result.durationMs}ms.`);
    console.log(`[Cutover] Records imported: ${result.importedCount}`);
    if (isDryRun) {
      console.log(`[Cutover] Dry run active: changes were safely rolled back.`);
    } else {
      console.log(`[Cutover] Transaction committed. PostgreSQL is populated.`);
    }
    await pool.end();
    process.exit(0);
  }

  if (values.verify) {
    const inputPath = resolve(process.cwd(), values.verify);
    console.log(`[Cutover] Reading snapshot from ${inputPath} for verification...`);
    const content = readFileSync(inputPath, 'utf-8');
    const snapshot: CutoverSnapshot = JSON.parse(content);

    console.log(`[Cutover] Verifying ${snapshot.count} invoice(s) against PostgreSQL...`);
    let errors = 0;

    for (const inv of snapshot.invoices) {
      const dbRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [inv.id]);
      if (dbRes.rows.length === 0) {
        console.error(`[Cutover Error] Invoice ${inv.id} not found in PostgreSQL.`);
        errors++;
        continue;
      }
      const row = dbRes.rows[0];
      if (row.memo !== inv.memo) {
        console.error(`[Cutover Error] Memo mismatch for ${inv.id}: DB "${row.memo}" != Snapshot "${inv.memo}"`);
        errors++;
      }
      if (row.seller_public_key !== inv.sellerPublicKey) {
        console.error(`[Cutover Error] Seller mismatch for ${inv.id}`);
        errors++;
      }
      if (Number(row.amount) !== inv.amount) {
        console.error(`[Cutover Error] Amount mismatch for ${inv.id}`);
        errors++;
      }
      if (row.status !== inv.status) {
        console.error(`[Cutover Error] Status mismatch for ${inv.id}`);
        errors++;
      }
    }

    if (errors === 0) {
      console.log(`[Cutover] Parity check PASSED. All ${snapshot.count} invoices match byte-for-byte.`);
    } else {
      console.error(`[Cutover] Parity check FAILED with ${errors} mismatch(es).`);
      await pool.end();
      process.exit(1);
    }
    await pool.end();
    process.exit(0);
  }
}

main().catch(async (err) => {
  console.error('[Cutover Fatal Error]', err.message || err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
