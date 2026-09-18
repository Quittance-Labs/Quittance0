import { Router } from 'express';
import stellarController from '../controllers/stellar.controller';
import paymentMonitorService from '../services/payment-monitor.service';
import postgresInvoiceStorage from '../storage/postgres-invoice-storage';
import memoryInvoiceStorage from '../storage/memory-invoice-storage';
import { createInvoiceRouter } from './invoice.routes';
import { createPaymentMonitorRouter } from './payment-monitor.routes';
import { healthHandler, readinessHandler } from '../health';
import { configuredStorageMode } from '../config/runtime';
import type { InvoiceStorage } from '../storage/invoice-storage';

/**
 * Resolves the active invoice storage backend based on runtime configuration.
 *
 * @returns Active InvoiceStorage implementation.
 */
export function resolveDefaultStorage(): InvoiceStorage {
  return configuredStorageMode() === 'postgres'
    ? postgresInvoiceStorage
    : memoryInvoiceStorage;
}

/**
 * Creates an Express router configured with the given invoice storage adapter.
 *
 * @param storage - Invoice storage adapter instance.
 * @returns Configured Express Router.
 */
export function createApiRouter(storage: InvoiceStorage = resolveDefaultStorage()): Router {
  const router = Router();

  router.get('/health', healthHandler(() => storage.mode));
  router.get('/ready', readinessHandler(() => storage.mode));
  router.use(createInvoiceRouter({ storage }));
  router.get('/stellar/account', stellarController.getAccountInfo.bind(stellarController));
  router.get('/stellar/payments', stellarController.getPayments.bind(stellarController));
  router.get('/stellar/transaction/:hash', stellarController.getTransaction.bind(stellarController));
  router.post('/stellar/verify-payment', stellarController.verifyPayment.bind(stellarController));
  router.use(createPaymentMonitorRouter(paymentMonitorService));

  return router;
}

let cachedMode: string | undefined;
let cachedRouter: Router | undefined;

function getActiveRouter(): Router {
  const currentMode = configuredStorageMode();
  if (cachedRouter && cachedMode === currentMode) {
    return cachedRouter;
  }
  const storage = currentMode === 'postgres' ? postgresInvoiceStorage : memoryInvoiceStorage;
  cachedRouter = createApiRouter(storage);
  cachedMode = currentMode;
  return cachedRouter;
}

const router = Router();
router.use((req, res, next) => {
  getActiveRouter()(req, res, next);
});

export default router;
