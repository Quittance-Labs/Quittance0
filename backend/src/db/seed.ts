import * as fs from 'fs';
import * as path from 'path';
import { pool } from '../config/database';

// SQL lives at the repo root (db/), the runner lives with the backend code so
// `npm run db:seed` (tsx src/db/seed.ts) resolves both the script and its
// dependencies.
const SQL_DIR = path.join(__dirname, '../../../db');

async function seed() {
  console.log('🌱 Seeding sample invoices...\n');

  try {
    const seedPath = path.join(SQL_DIR, 'seed.sql');
    const seedSql = fs.readFileSync(seedPath, 'utf-8');

    await pool.query(seedSql);

    const result = await pool.query(
      'SELECT seller_public_key, COUNT(*)::int AS invoices FROM invoices GROUP BY seller_public_key ORDER BY seller_public_key'
    );

    console.log('✅ Seed completed. Invoices per seller wallet:');
    for (const row of result.rows) {
      console.log(`  - ${row.seller_public_key}: ${row.invoices}`);
    }
    console.log('');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run seed
seed()
  .then(() => {
    console.log('✨ All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed error:', error);
    process.exit(1);
  });
