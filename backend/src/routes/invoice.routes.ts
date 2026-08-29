import { Router } from 'express';
import { createInvoiceHandlers, InvoiceHandlerOptions } from './invoice.handlers';

/**
 * Invoice routes shared by both servers. Mount under `/api`.
 */
export function createInvoiceRouter(options: InvoiceHandlerOptions): Router {
  const handlers = createInvoiceHandlers(options);
  const router = Router();

  router.post('/invoices', handlers.createInvoice);
  // Must stay before the dynamic /invoices/:id route to avoid shadowing.
  router.get('/invoices/stats', handlers.getStats);
  router.get('/invoices', handlers.getInvoices);
  router.get('/invoices/:id', handlers.getInvoice);
  router.get('/invoices/:id/payment-info', handlers.getPaymentInfo);
  router.post('/invoices/:id/cancel', handlers.cancelInvoice);
  router.post('/invoices/:id/verify', handlers.verifyPayment);
  router.post('/invoices/:id/simulate-payment', handlers.simulatePayment);

  return router;
}

export default createInvoiceRouter;
