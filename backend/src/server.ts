import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import { pool } from './config/database';
import { validateStellarConfig } from './config/stellar';
import paymentMonitorService from './services/payment-monitor.service';

// Load environment variables
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// API routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'One-Click Crypto Invoice API',
    version: '1.0.0',
    status: 'running',
    documentation: '/api/health',
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
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

// Initialize application
async function initialize() {
  try {
    console.log('🚀 Initializing One-Click Crypto Invoice Backend...');

    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected');

    // Validate Stellar configuration
    validateStellarConfig();

    // Start payment monitoring
    paymentMonitorService.start();

    // Start server
    app.listen(PORT, () => {
      console.log(`\n✅ Server running on port ${PORT}`);
      console.log(`📍 API: http://localhost:${PORT}/api`);
      console.log(`🏥 Health: http://localhost:${PORT}/api/health\n`);
    });
  } catch (error) {
    console.error('❌ Failed to initialize application:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('⚠️ SIGTERM signal received: closing HTTP server');
  paymentMonitorService.stop();
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⚠️ SIGINT signal received: closing HTTP server');
  paymentMonitorService.stop();
  await pool.end();
  process.exit(0);
});

// Start application
initialize();

export default app;

