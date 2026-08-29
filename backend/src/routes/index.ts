import { Router } from 'express';
import stellarController from '../controllers/stellar.controller';
import paymentMonitorService from '../services/payment-monitor.service';
import postgresInvoiceStorage from '../storage/postgres-invoice-storage';
import { createInvoiceRouter } from './invoice.routes';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Quittance API',
    storage: postgresInvoiceStorage.mode
  });
});

// Invoice routes — same handlers the MVP server uses, backed by PostgreSQL
router.use(createInvoiceRouter({ storage: postgresInvoiceStorage }));

// Stellar routes
router.get('/stellar/account', stellarController.getAccountInfo.bind(stellarController));
router.get('/stellar/payments', stellarController.getPayments.bind(stellarController));
router.get('/stellar/transaction/:hash', stellarController.getTransaction.bind(stellarController));
router.post('/stellar/verify-payment', stellarController.verifyPayment.bind(stellarController));

// Payment monitoring routes
router.post('/payment/sync', async (req, res) => {
  try {
    const limit = req.body.limit || 50;
    await paymentMonitorService.manualSync(limit);
    res.json({
      success: true,
      message: `Payment sync completed`,
      limit
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Sync failed'
    });
  }
});

export default router;

