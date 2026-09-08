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
  console.error('Unexpected database error:', err);
  process.exit(-1);
});

export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('Executed query', { text, duration, rows: res.rowCount });
  return res;
};

export default pool;

