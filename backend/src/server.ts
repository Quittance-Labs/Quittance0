import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import routes, { resolveDefaultStorage } from './routes';
import { pool } from './config/database';
import { validateStellarConfig, SELLER_PUBLIC_KEY } from './config/stellar';
import paymentMonitorService from './services/payment-monitor.service';
import invoiceService from './services/invoice.service';
import invoiceMemoryService from './services/invoice-memory.service';
import { FilePaymentMonitorCheckpointStore } from './services/payment-monitor-checkpoint';
import { configuredFrontendOrigins, corsOptions, configuredStorageMode } from './config/runtime';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3001;

app.use(cors(corsOptions()));

app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use('/api', routes);

app.get('/', (req: Request, res: Response) => {
  const storage = resolveDefaultStorage();
  res.json({
    name: 'Quittance API',
    version: '1.0.0',
    status: 'running',
    mode: storage.mode,
    documentation: '/api/health',
  });
});

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

async function initialize() {
  try {
    console.log('Starting server...');
    const mode = configuredStorageMode();

    if (mode === 'postgres') {
      await pool.query('SELECT NOW()');
      console.log('Database connected');

      if (SELLER_PUBLIC_KEY) {
        validateStellarConfig();
        paymentMonitorService.configure({
          invoices: invoiceService,
          database: pool,
        });
        paymentMonitorService.start();
      } else {
        console.log('Wallet-scoped mode: no SELLER_PUBLIC_KEY, payment monitor disabled');
      }
    } else {
      console.log('In-memory mode: database connection bypassed');

      if (SELLER_PUBLIC_KEY) {
        validateStellarConfig();
        paymentMonitorService.configure({
          invoices: invoiceMemoryService,
          database: undefined,
          checkpoints: new FilePaymentMonitorCheckpointStore(
            process.env.PAYMENT_MONITOR_CURSOR_FILE
              ? path.resolve(process.env.PAYMENT_MONITOR_CURSOR_FILE)
              : path.resolve('data/payment-monitor-checkpoint.json')
          ),
        });
        paymentMonitorService.start();
      } else {
        console.log('Wallet-scoped mode: no SELLER_PUBLIC_KEY, payment monitor disabled');
      }
    }
  } catch (error) {
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
}

/**
 * Starts the Express server listener on the specified port.
 *
 * @param port - Network port number or path string to bind. Defaults to PORT.
 * @returns Running HTTP server instance.
 */
export function startServer(port: number | string = PORT) {
  return app.listen(port, async () => {
    await initialize();
    const mode = configuredStorageMode();
    console.log(`\n🚀 Quittance Backend (${mode === 'postgres' ? 'Postgres' : 'In-Memory'} Mode)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Server running on port ${port}`);
    console.log(`📍 API: http://localhost:${port}/api`);
    console.log(`🏥 Health: http://localhost:${port}/api/health`);
    console.log(`💾 Storage: ${mode === 'postgres' ? 'PostgreSQL' : 'In-Memory'}`);
    console.log(`💰 Dynamic Seller: Each user uses their own wallet!`);
    console.log(`🌐 Frontends: ${configuredFrontendOrigins().join(', ') || 'not configured'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });
}

const entryPoint = process.argv[1] ?? '';
if (/server(\.[cm]?[jt]s)?$/.test(entryPoint)) {
  startServer();
}

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  paymentMonitorService.stop();
  if (configuredStorageMode() === 'postgres') {
    await pool.end();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  paymentMonitorService.stop();
  if (configuredStorageMode() === 'postgres') {
    await pool.end();
  }
  process.exit(0);
});

export default app;
