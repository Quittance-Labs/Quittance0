import { Router } from 'express';
import invoiceController from '../controllers/invoice.controller';
import stellarController from '../controllers/stellar.controller';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'Stellink API'
  });
});

// Invoice routes
router.post('/invoices', invoiceController.createInvoice.bind(invoiceController));
router.get('/invoices', invoiceController.getInvoices.bind(invoiceController));
router.get('/invoices/stats', invoiceController.getStats.bind(invoiceController));
router.get('/invoices/:id', invoiceController.getInvoice.bind(invoiceController));
router.get('/invoices/:id/payment-info', invoiceController.getPaymentInfo.bind(invoiceController));
router.post('/invoices/:id/cancel', invoiceController.cancelInvoice.bind(invoiceController));
router.post('/invoices/:id/verify', invoiceController.verifyPayment.bind(invoiceController));

// Stellar routes
router.get('/stellar/account', stellarController.getAccountInfo.bind(stellarController));
router.get('/stellar/payments', stellarController.getPayments.bind(stellarController));
router.get('/stellar/transaction/:hash', stellarController.getTransaction.bind(stellarController));
router.post('/stellar/verify-payment', stellarController.verifyPayment.bind(stellarController));

export default router;

