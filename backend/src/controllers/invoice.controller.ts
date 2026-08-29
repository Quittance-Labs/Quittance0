import { Request, Response } from 'express';
import invoiceService from '../services/invoice.service';
import stellarService from '../services/stellar.service';
import { createInvoiceSchema } from '../utils/validation';
import { generatePaymentQR, generateStellarPaymentQR } from '../utils/qrcode';
import { SELLER_PUBLIC_KEY, STELLAR_NETWORK } from '../config/stellar';
import {
  VERIFICATION_MESSAGES,
  checkInvoiceIsPayable,
  checkPayerInfo,
  checkTxHash,
  verifyHorizonPayment,
} from '../services/payment-verification';

class InvoiceController {
  async createInvoice(req: Request, res: Response) {
    try {
      const validatedData = createInvoiceSchema.parse(req.body);
      const invoice = await invoiceService.createInvoice(validatedData);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const paymentUrl = `${frontendUrl}/pay/${invoice.id}`;
      const qrCodeDataUrl = await generatePaymentQR(paymentUrl);
      const stellarQrCode = await generateStellarPaymentQR(
        invoice.sellerPublicKey,
        invoice.amount.toString(),
        invoice.assetCode,
        invoice.memo
      );

      res.status(201).json({
        success: true,
        data: {
          invoice,
          paymentUrl,
          qrCode: qrCodeDataUrl,
          stellarQrCode,
        },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create invoice',
      });
    }
  }

  async getInvoice(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const invoice = await invoiceService.getInvoiceById(id);

      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found',
        });
      }

      res.json({
        success: true,
        data: invoice,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get invoice',
      });
    }
  }

  async getInvoices(req: Request, res: Response) {
    try {
      const { status, limit = 50, offset = 0 } = req.query;

      const invoices = await invoiceService.getInvoicesBySeller(
        SELLER_PUBLIC_KEY,
        status as string | undefined,
        parseInt(limit as string),
        parseInt(offset as string)
      );

      res.json({
        success: true,
        data: invoices,
        pagination: {
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          total: invoices.length,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get invoices',
      });
    }
  }

  async cancelInvoice(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const invoice = await invoiceService.cancelInvoice(id);

      res.json({
        success: true,
        data: invoice,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to cancel invoice',
      });
    }
  }

  // Verifies through the shared verification module so this path applies the same
  // memo/destination/amount/asset checks as the MVP server (issue #224).
  async verifyPayment(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { network } = req.body;

      const hashCheck = checkTxHash(req.body?.txHash);
      if (!hashCheck.ok) {
        return res.status(400).json({ success: false, code: hashCheck.code, error: hashCheck.error });
      }

      const payerCheck = checkPayerInfo(req.body);
      if (!payerCheck.ok) {
        return res.status(400).json({ success: false, code: payerCheck.code, error: payerCheck.error });
      }

      const invoice = await invoiceService.getInvoiceById(id);

      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found',
        });
      }

      const statusCheck = checkInvoiceIsPayable(invoice.status);
      if (!statusCheck.ok) {
        return res.status(400).json({ success: false, code: statusCheck.code, error: statusCheck.error });
      }

      let txDetails;
      try {
        txDetails = await stellarService.getTransaction(hashCheck.value);
      } catch (error: any) {
        console.error('Verify payment lookup error:', error);
        return res.status(404).json({
          success: false,
          code: 'TRANSACTION_NOT_FOUND',
          error: VERIFICATION_MESSAGES.TRANSACTION_NOT_FOUND,
        });
      }

      const verification = verifyHorizonPayment({
        txHash: hashCheck.value,
        expected: {
          memo: invoice.memo,
          amount: invoice.amount,
          destination: invoice.sellerPublicKey,
          assetCode: invoice.assetCode,
          assetIssuer: invoice.assetIssuer,
          network: STELLAR_NETWORK,
        },
        transaction: txDetails.transaction,
        operations: txDetails.operations,
        network,
      });

      if (!verification.ok) {
        return res.status(400).json({
          success: false,
          code: verification.code,
          error: verification.error,
        });
      }

      const updatedInvoice = await invoiceService.markAsPaid(
        invoice.id,
        verification.value.txHash,
        verification.value.from,
        payerCheck.value
      );

      res.json({
        success: true,
        data: updatedInvoice,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to verify payment',
      });
    }
  }

  async getStats(req: Request, res: Response) {
    try {
      const stats = await invoiceService.getInvoiceStats(SELLER_PUBLIC_KEY);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get stats',
      });
    }
  }

  async getPaymentInfo(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const invoice = await invoiceService.getInvoiceById(id);

      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found',
        });
      }

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const paymentUrl = `${frontendUrl}/pay/${invoice.id}`;

      const qrCodeDataUrl = await generatePaymentQR(paymentUrl);
      const stellarQrCode = await generateStellarPaymentQR(
        invoice.sellerPublicKey,
        invoice.amount.toString(),
        invoice.assetCode,
        invoice.memo
      );

      res.json({
        success: true,
        data: {
          paymentUrl,
          qrCode: qrCodeDataUrl,
          stellarQrCode,
          invoice,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get payment info',
      });
    }
  }
}

export default new InvoiceController();

