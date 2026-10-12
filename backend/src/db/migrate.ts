import { pool } from '../config/database';
import { runMigrations, checkMigrationStatus } from './migration-runner';

export async function migrate() {
  console.log('🚀 Starting database migration...\n');

  try {
    const result = await runMigrations(pool);

    if (result.adopted.length > 0) {
      console.log('📦 Adopted baseline migrations for existing database:');
      for (const m of result.adopted) {
        console.log(`  - ${m.version}_${m.name} (adopted)`);
      }
    }

    if (result.applied.length > 0) {
      console.log('✅ Applied migrations:');
      for (const m of result.applied) {
        console.log(`  - ${m.version}_${m.name}`);
      }
    } else if (result.adopted.length === 0) {
      console.log('✨ No pending migrations. Database schema is already up to date.');
    }

    console.log(`\n📌 Current schema version: ${result.latestVersion || 'none'}\n`);
    return result;
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run CLI when invoked directly
if (require.main === module || process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  migrate()
    .then(() => {
      console.log('✨ All done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration error:', error);
      process.exit(1);
    });
}
