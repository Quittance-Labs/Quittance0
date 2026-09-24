// Dual-backend entrypoint.
//
// This is the single server file that honours INVOICE_STORAGE to choose
// between the in-memory MVP and PostgreSQL storage adapters at boot time.
// It is the recommended starting point for any environment that might need
// either backend: local development, staging, or production.
//
// Backend selection:
//   INVOICE_STORAGE=memory   → MemoryInvoiceStorage (no DATABASE_URL needed)
//   INVOICE_STORAGE=postgres → PostgresInvoiceStorage (requires DATABASE_URL)
//   (unset)                  → postgres when DATABASE_URL is set, memory otherwise
//
// Both adapters satisfy the same required InvoiceStorage contract (issue #555)
// so all handlers, routes, and middleware stay identical regardless of which
// backend is active. Do not branch handlers on storage.mode — prove behaviour
// in the shared suite instead.
//
// Usage:
//   npm run dev:dual           # development (tsx watch)
//   npm run start:dual:prod    # production (node dist)

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { createInvoiceRouter } from './routes/invoice.routes';
import { createPaymentMonitorRouter } from './routes/payment-monitor.routes';
import { FilePaymentMonitorCheckpointStore } from './services/payment-monitor-checkpoint';
import paymentMonitorService from './services/payment-monitor.service';
import invoiceMemoryService from './services/invoice-memory.service';
import { MemoryInvoiceStorage } from './storage/memory-invoice-storage';
import { PostgresInvoiceStorage } from './storage/postgres-invoice-storage';
import { InvoiceService } from './services/invoice.service';
import { pool } from './config/database';
import { SELLER_PUBLIC_KEY, validateStellarConfig } from './config/stellar';
import { configuredFrontendOrigins, configuredStorageMode, corsOptions } from './config/runtime';
import { healthHandler, readinessHandler } from './health';
import type { InvoiceStorage } from './storage/invoice-storage';

dotenv.config();

// ── Storage selection ────────────────────────────────────────────────────────
//
// configuredStorageMode() throws synchronously when INVOICE_STORAGE=postgres
// but DATABASE_URL is absent, so a misconfigured deploy surfaces at process
// start rather than silently serving in-memory data.

const storageMode = configuredStorageMode();
let storage: InvoiceStorage;

if (storageMode === 'postgres') {
  storage = new PostgresInvoiceStorage(new InvoiceService(pool));
} else {
  storage = new MemoryInvoiceStorage(invoiceMemoryService);
}

// ── Payment monitor ──────────────────────────────────────────────────────────

paymentMonitorService.configure({
  invoices: storageMode === 'postgres' ? undefined : invoiceMemoryService,
  database: storageMode === 'postgres' ? pool : undefined,
  checkpoints: new FilePaymentMonitorCheckpointStore(
    process.env.PAYMENT_MONITOR_CURSOR_FILE
      ? path.resolve(process.env.PAYMENT_MONITOR_CURSOR_FILE)
      : path.resolve('data/payment-monitor-checkpoint.json')
  ),
});

// ── Express application ──────────────────────────────────────────────────────

const app: Application = express();
const PORT = process.env.PORT || 3001;

app.use(cors(corsOptions()));
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'Quittance API (Dual)',
    version: '1.0.0',
    status: 'running',
    mode: storage.mode,
    documentation: '/api/health',
  });
});

// Liveness probes (process up, cold-start safe, no external dependency)
app.get('/api/health', healthHandler(storage.mode));
app.get('/api/health/live', healthHandler(storage.mode));
app.get('/health', healthHandler(storage.mode));
app.get('/healthz', healthHandler(storage.mode));

// Readiness probes (traffic routing, critical config validation)
app.get('/api/ready', readinessHandler(storage.mode));
app.get('/api/health/ready', readinessHandler(storage.mode));
app.get('/ready', readinessHandler(storage.mode));
app.get('/readyz', readinessHandler(storage.mode));

// Invoice routes — storage-agnostic; adapter is injected here
app.use('/api', createInvoiceRouter({ storage, paymentMonitor: paymentMonitorService }));
app.use('/api', createPaymentMonitorRouter(paymentMonitorService));

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if ((err as any).type === 'entity.too.large' || (err as any).status === 413 || (err as any).statusCode === 413) {
    return res.status(413).json({
      success: false,
      code: 'PAYLOAD_TOO_LARGE',
      error: 'Payload too large: request body exceeds 16 kB limit',
    });
  }
  console.error('Unhandled error:', err);
  const code = (err as Error & { code?: string }).code;
  res.status(code === 'CORS_ORIGIN_DENIED' ? 403 : 500).json({
    success: false,
    code,
    error: err.message || 'Internal server error',
  });
});

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// ── Boot sequence ────────────────────────────────────────────────────────────

async function initialize(): Promise<void> {
  if (storageMode === 'postgres') {
    // Verify the database is reachable before accepting traffic.
    try {
      await pool.query('SELECT NOW()');
      console.log('✅ Database connected');
    } catch (error) {
      console.error('Failed to connect to database:', error);
      process.exit(1);
    }
  }

  if (SELLER_PUBLIC_KEY) {
    try {
      if (storageMode === 'postgres') {
        validateStellarConfig();
      }
      paymentMonitorService.start();
    } catch (error) {
      console.warn('Payment monitor not started:', error);
    }
  } else {
    console.log('Wallet-scoped mode: no SELLER_PUBLIC_KEY, payment monitor disabled');
  }
}

/**
 * Starts the HTTP listener.
 *
 * Exported so integration tests can bind an ephemeral port instead of the
 * configured one. Importing this module never starts a server on its own.
 */
export function startServer(port: number | string = PORT) {
  const server = app.listen(port, async () => {
    await initialize();
    const modeLabel = storageMode === 'postgres' ? 'PostgreSQL' : 'In-Memory (MVP)';
    console.log('\n🚀 Quittance Backend (Dual-Mode)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Server running on port ${port}`);
    console.log(`📍 API:     http://localhost:${port}/api`);
    console.log(`🏥 Health:  http://localhost:${port}/api/health`);
    console.log(`💾 Storage: ${modeLabel}`);
    console.log(`🌐 INVOICE_STORAGE: ${process.env.INVOICE_STORAGE || '(auto)'}`);
    console.log(`💰 Dynamic Seller: Each user uses their own wallet`);
    console.log(`🌐 Frontends: ${configuredFrontendOrigins().join(', ') || 'not configured'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });
  return server;
}

const entryPoint = process.argv[1] ?? '';
if (/server-dual(\.[cm]?[jt]s)?$/.test(entryPoint)) {
  startServer();
}

process.on('SIGTERM', async () => {
  paymentMonitorService.stop();
  if (storageMode === 'postgres') {
    await pool.end();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  paymentMonitorService.stop();
  if (storageMode === 'postgres') {
    await pool.end();
  }
  process.exit(0);
});

export { storage, storageMode };
export default app;
