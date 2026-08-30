import { Request, Response } from 'express';
import stellarService from '../services/stellar.service';
import { createInvoiceSchema } from '../utils/validation';
import { generatePaymentQR, generateStellarPaymentQR } from '../utils/qrcode';
import { sendFailure, sendSuccess, sendVerificationFailure } from '../types/api';
import type { InvoiceStorage, StoredInvoice } from '../storage/invoice-storage';
import { STELLAR_NETWORK } from '../config/stellar';
import {
  VERIFICATION_MESSAGES,
  checkInvoiceIsPayable,
  checkPayerInfo,
  checkTxHash,
  verifyHorizonPayment,
} from '../services/payment-verification';

/** Only the part of the Stellar service the verify handler needs. */
export interface TransactionLookup {
  getTransaction(txHash: string): Promise<any>;
}

export interface InvoiceHandlerOptions {
  storage: InvoiceStorage;
  /** Defaults to FRONTEND_URL, read per request so tests and dev reloads see changes. */
  frontendUrl?: string;
  /** Defaults to ALLOW_SIMULATE=true. */
  allowSimulate?: boolean;
  stellar?: TransactionLookup;
}

export interface InvoiceHandlers {
  createInvoice(req: Request, res: Response): Promise<void>;
  getInvoice(req: Request, res: Response): Promise<void>;
  getInvoices(req: Request, res: Response): Promise<void>;
  getPaymentInfo(req: Request, res: Response): Promise<void>;
  cancelInvoice(req: Request, res: Response): Promise<void>;
  verifyPayment(req: Request, res: Response): Promise<void>;
  getStats(req: Request, res: Response): Promise<void>;
  simulatePayment(req: Request, res: Response): Promise<void>;
}

/**
 * Log the stack/message rather than the error object: some validation errors
 * (zod) cannot be inspected by `console` on newer Node versions, and the throw
 * would escape the catch block and leave the request hanging.
 */
function logError(label: string, error: any): void {
  console.error(label, error?.stack || error?.message || error);
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Invoice route handlers shared by the MVP (in-memory) and Postgres servers.
 * The only difference between the two entrypoints is the storage adapter.
 */
export function createInvoiceHandlers(options: InvoiceHandlerOptions): InvoiceHandlers {
  const { storage } = options;
  const stellar: TransactionLookup = options.stellar || stellarService;

  const frontendUrl = () =>
    options.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000';

  const simulateAllowed = () =>
    options.allowSimulate !== undefined
      ? options.allowSimulate
      : process.env.ALLOW_SIMULATE === 'true';

  const buildPaymentPayload = async (invoice: StoredInvoice) => {
    const paymentUrl = `${frontendUrl()}/pay/${invoice.id}`;

    if (invoice.status !== 'PENDING') {
      return {
        paymentAvailable: false,
        paymentUrl,
        qrCode: null,
        stellarQrCode: null,
      };
    }

    return {
      paymentAvailable: true,
      paymentUrl,
      qrCode: await generatePaymentQR(paymentUrl),
      stellarQrCode: await generateStellarPaymentQR(
        invoice.sellerPublicKey,
        invoice.amount.toString(),
        invoice.assetCode,
        invoice.memo,
        invoice.assetIssuer
      ),
    };
  };

  return {
    async createInvoice(req: Request, res: Response) {
      try {
        const validatedData = createInvoiceSchema.parse(req.body);
        const invoice = await storage.createInvoice(validatedData);
        const payment = await buildPaymentPayload(invoice);

        sendSuccess(res, 201, {
          invoice,
          paymentAvailable: payment.paymentAvailable,
          paymentUrl: payment.paymentUrl,
          qrCode: payment.qrCode,
          stellarQrCode: payment.stellarQrCode,
        });
      } catch (error: any) {
        logError('Create invoice error:', error);
        sendFailure(res, 400, error.message || 'Failed to create invoice');
      }
    },

    async getInvoice(req: Request, res: Response) {
      try {
        const invoice = await storage.getInvoiceById(req.params.id);

        if (!invoice) {
          return sendFailure(res, 404, 'Invoice not found');
        }

        sendSuccess(res, 200, invoice);
      } catch (error: any) {
        logError('Get invoice error:', error);
        sendFailure(res, 500, error.message || 'Failed to get invoice');
      }
    },

    async getInvoices(req: Request, res: Response) {
      try {
        const { status, sellerPublicKey } = req.query;

        if (!sellerPublicKey) {
          return sendFailure(res, 400, 'sellerPublicKey query parameter is required');
        }

        const limit = toPositiveInt(req.query.limit, 50);
        const offset = toPositiveInt(req.query.offset, 0);

        const invoices = await storage.getInvoicesBySeller(
          sellerPublicKey as string,
          status as string | undefined,
          limit,
          offset
        );

        sendSuccess(res, 200, invoices, {
          pagination: { limit, offset, total: invoices.length },
        });
      } catch (error: any) {
        logError('Get invoices error:', error);
        sendFailure(res, 500, error.message || 'Failed to get invoices');
      }
    },

    async getPaymentInfo(req: Request, res: Response) {
      try {
        const invoice = await storage.getInvoiceById(req.params.id);

        if (!invoice) {
          return sendFailure(res, 404, 'Invoice not found');
        }

        const payment = await buildPaymentPayload(invoice);

        sendSuccess(res, 200, { ...payment, invoice });
      } catch (error: any) {
        logError('Get payment info error:', error);
        sendFailure(res, 500, error.message || 'Failed to get payment info');
      }
    },

    async cancelInvoice(req: Request, res: Response) {
      try {
        const invoice = await storage.cancelInvoice(req.params.id);
        sendSuccess(res, 200, invoice);
      } catch (error: any) {
        logError('Cancel invoice error:', error);
        sendFailure(res, 400, error.message || 'Failed to cancel invoice');
      }
    },

    async verifyPayment(req: Request, res: Response) {
      try {
        const { id } = req.params;
        const { network } = req.body || {};

        const hashCheck = checkTxHash(req.body?.txHash);
        if (!hashCheck.ok) {
          return sendVerificationFailure(res, 400, hashCheck.code, hashCheck.error);
        }

        const payerCheck = checkPayerInfo(req.body);
        if (!payerCheck.ok) {
          return sendVerificationFailure(res, 400, payerCheck.code, payerCheck.error);
        }

        const invoice = await storage.getInvoiceById(id);

        if (!invoice) {
          return sendFailure(res, 404, 'Invoice not found');
        }

        const statusCheck = checkInvoiceIsPayable(invoice.status);
        if (!statusCheck.ok) {
          return sendVerificationFailure(res, 400, statusCheck.code, statusCheck.error);
        }

        let txDetails;
        try {
          txDetails = await stellar.getTransaction(hashCheck.value);
        } catch (error: any) {
          logError('Verify payment lookup error:', error);
          return sendVerificationFailure(
            res,
            404,
            'TRANSACTION_NOT_FOUND',
            VERIFICATION_MESSAGES.TRANSACTION_NOT_FOUND
          );
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
          return sendVerificationFailure(res, 400, verification.code, verification.error);
        }

        let updatedInvoice: StoredInvoice;
        try {
          updatedInvoice = await storage.markAsPaid(
            id,
            verification.value.txHash,
            verification.value.from,
            payerCheck.value
          );
        } catch (error) {
          // The payment lookup can cross expiresAt after the first status read.
          // Re-read so that race still returns the public expiry contract.
          const latest = await storage.getInvoiceById(id);
          const latestStatus = latest && checkInvoiceIsPayable(latest.status);
          if (latestStatus && !latestStatus.ok) {
            return sendVerificationFailure(
              res,
              400,
              latestStatus.code,
              latestStatus.error
            );
          }
          throw error;
        }

        sendSuccess(res, 200, updatedInvoice, { message: 'Payment verified on Stellar' });
      } catch (error: any) {
        logError('Verify payment error:', error);
        sendFailure(res, 500, error.message || 'Failed to verify payment');
      }
    },

    async getStats(req: Request, res: Response) {
      try {
        const { sellerPublicKey } = req.query;

        if (!sellerPublicKey) {
          return sendFailure(res, 400, 'sellerPublicKey query parameter is required');
        }

        const stats = await storage.getInvoiceStats(sellerPublicKey as string);
        sendSuccess(res, 200, stats);
      } catch (error: any) {
        logError('Get stats error:', error);
        sendFailure(res, 500, error.message || 'Failed to get statistics');
      }
    },

    // Local testing only — hidden unless ALLOW_SIMULATE=true.
    async simulatePayment(req: Request, res: Response) {
      try {
        if (!simulateAllowed()) {
          return sendFailure(res, 404, 'Endpoint not found');
        }

        const { id } = req.params;
        const invoice = await storage.getInvoiceById(id);

        if (!invoice) {
          return sendFailure(res, 404, 'Invoice not found');
        }

        const statusCheck = checkInvoiceIsPayable(invoice.status);
        if (!statusCheck.ok) {
          return sendVerificationFailure(res, 400, statusCheck.code, statusCheck.error);
        }

        const mockTxHash = `MOCK_TX_${Date.now().toString(36).toUpperCase()}_${Math.random()
          .toString(36)
          .substring(2, 10)
          .toUpperCase()}`;
        const mockPayerKey = 'GXXXSIMULATEDPAYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

        const updatedInvoice = await storage.markAsPaid(id, mockTxHash, mockPayerKey);

        sendSuccess(res, 200, updatedInvoice, { message: 'Payment simulated successfully' });
      } catch (error: any) {
        logError('Simulate payment error:', error);
        sendFailure(res, 500, error.message || 'Failed to simulate payment');
      }
    },
  };
}

export default createInvoiceHandlers;
