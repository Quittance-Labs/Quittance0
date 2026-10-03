import { emitOperationalFailure } from '../observability/log-events';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL connection pool used by InvoiceService (and the migrate+seed
// runners). Same column names are written/read by invoice.service.ts as are
// kept in memory-storage.ts, so query results map directly onto the shared
// StoredInvoice interface without any intermediate renaming. Any pg Pool
// option changes here are mirrored in the FakeInvoiceDb test double so unit
// tests continue to approximate real behaviour.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  emitOperationalFailure('database.pool');
  process.exit(-1);
});

export const query = async (text: string, params?: any[]) => {
  const res = await pool.query(text, params);
  return res;
};

export default pool;

