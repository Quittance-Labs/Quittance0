import { Router } from 'express';
import stellarController from '../controllers/stellar.controller';
import paymentMonitorService from '../services/payment-monitor.service';
import postgresInvoiceStorage from '../storage/postgres-invoice-storage';
import { createInvoiceRouter } from './invoice.routes';
import { createPaymentMonitorRouter } from './payment-monitor.routes';
import { healthHandler, readinessHandler } from '../health';

const router = Router();

// Health check
router.get('/health', healthHandler(postgresInvoiceStorage.mode));
router.get('/ready', readinessHandler(postgresInvoiceStorage.mode));

// Invoice routes — same handlers the MVP server uses, backed by PostgreSQL
router.use(createInvoiceRouter({ storage: postgresInvoiceStorage, paymentMonitor: paymentMonitorService }));

// Stellar routes
router.get('/stellar/account', stellarController.getAccountInfo.bind(stellarController));
router.get('/stellar/payments', stellarController.getPayments.bind(stellarController));
router.get('/stellar/transaction/:hash', stellarController.getTransaction.bind(stellarController));
router.post('/stellar/verify-payment', stellarController.verifyPayment.bind(stellarController));
router.use(createPaymentMonitorRouter(paymentMonitorService));

export default router;
