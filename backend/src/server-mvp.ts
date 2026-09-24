// MVP in-memory backend. Mirrors server.ts exactly in HTTP surface, route
// order, response envelopes and StoredInvoice shape — the only substantive
// difference is the storage adapter passed to createInvoiceRouter. Both
// servers export startServer(port?) with the same signature so the same
// integration harness (see invoice-payment-loop.test.ts) can drive either.
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { createInvoiceRouter } from './routes/invoice.routes';
import memoryInvoiceStorage from './storage/memory-invoice-storage';
import invoiceMemoryService from './services/invoice-memory.service';
import paymentMonitorService from './services/payment-monitor.service';
import { createPaymentMonitorRouter } from './routes/payment-monitor.routes';
import { FilePaymentMonitorCheckpointStore } from './services/payment-monitor-checkpoint';
import { SELLER_PUBLIC_KEY } from './config/stellar';
import { configuredFrontendOrigins, corsOptions } from './config/runtime';
import { healthHandler, readinessHandler } from './health';
import { bodyLimitErrorHandler, MAX_BODY_STRING } from './middleware/body-limit';

dotenv.config();

paymentMonitorService.configure({
  invoices: invoiceMemoryService,
  database: undefined,
  checkpoints: new FilePaymentMonitorCheckpointStore(
    process.env.PAYMENT_MONITOR_CURSOR_FILE
      ? path.resolve(process.env.PAYMENT_MONITOR_CURSOR_FILE)
      : path.resolve('data/payment-monitor-checkpoint.json')
  ),
});

const app: Application = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors(corsOptions()));

app.use(express.json({ limit: MAX_BODY_STRING }));
app.use(express.urlencoded({ extended: true, limit: MAX_BODY_STRING }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'Quittance API (MVP)',
    version: '1.0.0',
    status: 'running',
    mode: memoryInvoiceStorage.mode,
    documentation: '/api/health',
  });
});

// Liveness probes (process up, cold-start safe, no external dependency)
app.get('/api/health', healthHandler(memoryInvoiceStorage.mode));
app.get('/api/health/live', healthHandler(memoryInvoiceStorage.mode));
app.get('/health', healthHandler(memoryInvoiceStorage.mode));
app.get('/healthz', healthHandler(memoryInvoiceStorage.mode));

// Readiness probes (traffic routing, critical config validation, optional Horizon ping)
app.get('/api/ready', readinessHandler(memoryInvoiceStorage.mode));
app.get('/api/health/ready', readinessHandler(memoryInvoiceStorage.mode));
app.get('/ready', readinessHandler(memoryInvoiceStorage.mode));
app.get('/readyz', readinessHandler(memoryInvoiceStorage.mode));

app.use('/api', createInvoiceRouter({ storage: memoryInvoiceStorage, paymentMonitor: paymentMonitorService }));
app.use('/api', createPaymentMonitorRouter(paymentMonitorService));

// Mock Stellar endpoint (MVP only)
app.get('/api/stellar/account', (req: Request, res: Response) => {
  const { publicKey } = req.query;
  res.json({
    success: true,
    data: {
      publicKey: publicKey || 'EXAMPLE',
      balances: [
        { assetCode: 'XLM', balance: '1000.0000000' },
      ],
      sequence: '12345678',
      subentryCount: 0,
    },
  });
});

// Body-limit (413) then generic error handling
app.use(bodyLimitErrorHandler);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  const code = (err as Error & { code?: string }).code;
  // Keep the shared failure envelope: `success:false` with an optional stable
  // `code`, the same shape every route and the verify path already use.
  res.status(code === 'CORS_ORIGIN_DENIED' ? 403 : 500).json({
    success: false,
    code,
    error: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

/**
 * Starts the HTTP listener.
 *
 * Exported so integration tests can bind an ephemeral port instead of the
 * configured one, and so importing this module never starts a server.
 */
export function startServer(port: number | string = PORT) {
  if (SELLER_PUBLIC_KEY) {
    try {
      paymentMonitorService.start();
    } catch (error) {
      console.warn('Payment monitor not started:', error);
    }
  }

  return app.listen(port, () => {
    console.log('\n🚀 Quittance Backend (MVP Mode)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Server running on port ${port}`);
    console.log(`📍 API: http://localhost:${port}/api`);
    console.log(`🏥 Health: http://localhost:${port}/api/health`);
    console.log(`💾 Storage: In-Memory (No Database)`);
    console.log(`💰 Dynamic Seller: Each user uses their own wallet!`);
    console.log(`🌐 Frontends: ${configuredFrontendOrigins().join(', ') || 'not configured'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });
}

const entryPoint = process.argv[1] ?? '';
if (/server-mvp(\.[cm]?[jt]s)?$/.test(entryPoint)) {
  startServer();
}

process.on('SIGTERM', () => {
  paymentMonitorService.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  paymentMonitorService.stop();
  process.exit(0);
});

export default app;
