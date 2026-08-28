import * as fs from 'fs';
import * as path from 'path';
import { pool } from '../config/database';

// SQL lives at the repo root (db/), the runner lives with the backend code so
// `npm run db:migrate` (tsx src/db/migrate.ts) resolves both the script and its
// dependencies.
const SQL_DIR = path.join(__dirname, '../../../db');

async function migrate() {
  console.log('🚀 Starting database migration...\n');

  try {
    const schemaPath = path.join(SQL_DIR, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    await pool.query(schema);

    console.log('✅ Database migration completed successfully!\n');
    console.log('📋 Created tables:');
    console.log('  - invoices (keyed by seller_public_key)');
    console.log('  - transactions');
    console.log('  - payment_events');
    console.log('\n📊 Created views:');
    console.log('  - invoice_stats\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('✨ All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration error:', error);
    process.exit(1);
  });
