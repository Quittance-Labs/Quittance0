// Handlers for both backends (in-memory and PostgreSQL). They take an
// InvoiceStorage implementation and do not branch on the storage mode, so a
// bug in one backend is a bug in both. All seller/payer/asset/customer/
// metadata/expiry fields pass through unchanged from the storage layer. The
// shared suite in invoice-handlers.test.ts runs these same handlers against
// both adapters with the same assertions to guarantee field parity.
import { Request, Response } from 'express';
import stellarService from '../services/stellar.service';
import {
  cancelInvoiceSchema,
  createInvoiceFieldErrors,
  createInvoiceSchema,
  stellarPublicKeySchema,
} from '../utils/validation';
import { firstCreateInvoiceMessage } from '../../../shared/invoice-validation';
import { generatePaymentQR, generateStellarPaymentQR } from '../utils/qrcode';
import {
  sendFailure,
  sendSuccess,
  sendValidationFailure,
  sendVerificationFailure,
} from '../types/api';
import type { InvoiceStorage, StoredInvoice } from '../storage/invoice-storage';
import { idempotencyKeyForCreate } from '../utils/idempotency';
import { STELLAR_NETWORK } from '../config/stellar';
import {
  failure,
  checkInvoiceIsPayable,
  checkPayerInfo,
  checkTxHash,
  messageForCode,
  verifyHorizonPayment,
} from '../services/payment-verification';
import { PaymentClaimError } from '../domain/payment-attribution';
import {
  SettlementTimeUnavailableError,
  warningForLatePayment,
} from '../domain/invoice-settlement';
import { cutoverDrainMode, simulationAllowed } from '../config/runtime';
import { createRequestId } from '../utils/request-correlation-id';
import { checkInvoiceVerifyLimit } from '../middleware/rate-limit';
import { cacheVerificationResult } from '../middleware/verify-cache';
import { verifySellerSignature } from '../utils/signature-verification';

/** Kept explicit so clients can tune polling without duplicating backend policy. */
export const PAYMENT_STATUS_POLL_INTERVAL_MS = 3000;

/** Only the part of the Stellar service the verify handler needs. */
export interface TransactionLookup {
  getTransaction(txHash: string): Promise<any>;
}

export interface PaymentMonitorWatchRegistry {
  registerWatch(invoice: any): void;
  unregisterWatch(invoiceId: string): void;
}

export interface InvoiceHandlerOptions {
  storage: InvoiceStorage;
  /** Defaults to FRONTEND_URL, read per request so tests and dev reloads see changes. */
  frontendUrl?: string;
  /** Optional local-test override. Production always forces simulation off. */
  allowSimulate?: boolean;
  stellar?: TransactionLookup;
  requireCancelSignature?: boolean;
  paymentMonitor?: PaymentMonitorWatchRegistry;
  now?: () => number;
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
function logError(label: string, error: any, requestId?: string): void {
  const prefix = requestId ? `[${requestId}] ` : '';
  console.error(`${prefix}${label}`, error?.stack || error?.message || error);
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
    process.env.NODE_ENV !== 'production' && (
      options.allowSimulate !== undefined
        ? options.allowSimulate
        : simulationAllowed()
    );

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
      statusPollingIntervalMs: PAYMENT_STATUS_POLL_INTERVAL_MS,
      qrCode: await generatePaymentQR(paymentUrl),
      stellarQrCode: await generateStellarPaymentQR(
        invoice.sellerPublicKey,
        invoice.amount.toString(),
        invoice.assetCode || 'XLM',
        invoice.memo,
        invoice.assetIssuer
      ),
    };
  };

  return {
    async createInvoice(req: Request, res: Response) {
      if (cutoverDrainMode()) {
        return sendFailure(
          res,
          503,
          'System is in cutover drain mode. New invoice creation is temporarily paused.'
        );
      }
      const requestId = createRequestId();
      try {
        const parsed = createInvoiceSchema.safeParse(req.body);
        if (!parsed.success) {
          const fieldErrors = createInvoiceFieldErrors(parsed.error);
          return sendValidationFailure(
            res,
            firstCreateInvoiceMessage(fieldErrors) || 'Invalid invoice payload',
            fieldErrors
          );
        }
        const validatedData = parsed.data;
        if (validatedData.network && validatedData.network !== STELLAR_NETWORK) {
          return sendFailure(res, 400, 'Client wallet network does not match the server Stellar network');
        }
        const rawKey = req.headers?.['idempotency-key'];
        const headerKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
        if (typeof headerKey === 'string' && headerKey) {
          if (headerKey.length > 200 || !/^[A-Za-z0-9_:\-]+$/.test(headerKey)) {
            return sendFailure(res, 400, 'Idempotency-Key header is invalid');
          }
          validatedData.idempotencyKey = headerKey;
        }
        validatedData.idempotencyKey = idempotencyKeyForCreate(
          validatedData,
          options.now ? options.now() : Date.now()
        );
        const invoice = await storage.createInvoice(validatedData);
        options.paymentMonitor?.registerWatch(invoice);
        const payment = await buildPaymentPayload(invoice);

        sendSuccess(res, 201, {
          invoice,
          paymentAvailable: payment.paymentAvailable,
          paymentUrl: payment.paymentUrl,
          statusPollingIntervalMs: payment.statusPollingIntervalMs,
          qrCode: payment.qrCode,
          stellarQrCode: payment.stellarQrCode,
        });
      } catch (error: any) {
        logError('Create invoice error:', error, requestId);
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
        const sellerCheck = stellarPublicKeySchema.safeParse(sellerPublicKey);
        if (!sellerCheck.success) {
          return sendFailure(res, 400, 'sellerPublicKey must be a valid Stellar public key');
        }

        const limit = toPositiveInt(req.query.limit, 50);
        const offset = toPositiveInt(req.query.offset, 0);

        const invoices = await storage.getInvoicesBySeller(
          sellerCheck.data,
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

    async cancelInvoice(req: Request, res: Response): Promise<void> {
      try {
        let sellerPublicKey: string | undefined;
        let signature: string | undefined;

        if (req.body && typeof req.body === 'object') {
          if ('sellerPublicKey' in req.body) {
            const parsed = cancelInvoiceSchema.safeParse(req.body);
            if (!parsed.success) {
              sendFailure(res, 400, 'Invalid Stellar public key format');
              return;
            }
            sellerPublicKey = parsed.data.sellerPublicKey;
          }
          if ('signature' in req.body && typeof req.body.signature === 'string') {
            signature = req.body.signature;
          }
        }

        if (!sellerPublicKey && req.query.sellerPublicKey) {
          const parsed = stellarPublicKeySchema.safeParse(req.query.sellerPublicKey);
          if (!parsed.success) {
            sendFailure(res, 400, 'Invalid Stellar public key format');
            return;
          }

          // Fallback to claimed key (legacy, insecure)
          if (req.body && typeof req.body === 'object' && 'sellerPublicKey' in req.body) {
            const parsed = cancelInvoiceSchema.safeParse(req.body);
            if (!parsed.success) {
              return sendFailure(res, 400, 'Invalid Stellar public key format');
            }
            sellerPublicKey = parsed.data.sellerPublicKey;
          } else if (req.query.sellerPublicKey) {
            const parsed = stellarPublicKeySchema.safeParse(req.query.sellerPublicKey);
            if (!parsed.success) {
              return sendFailure(res, 400, 'Invalid Stellar public key format');
            }
            sellerPublicKey = parsed.data;
          }
        }

        // Require explicit ownership proof (no more unauthenticated cancellation)
        if (!sellerPublicKey) {
          return sendFailure(
            res,
            401,
            'Unauthorized: sellerPublicKey is required to cancel an invoice'
          );
        }

        if (!sellerPublicKey && req.headers?.['x-seller-public-key']) {
          const headerKey = req.headers['x-seller-public-key'];
          const parsed = stellarPublicKeySchema.safeParse(Array.isArray(headerKey) ? headerKey[0] : headerKey);
          if (parsed.success) {
            sellerPublicKey = parsed.data;
          }
        }

        if (!signature && req.headers?.['x-signature']) {
          const headerSig = req.headers['x-signature'];
          signature = Array.isArray(headerSig) ? headerSig[0] : headerSig;
        }

        const requireSignature =
          options.requireCancelSignature ?? (process.env.REQUIRE_CANCEL_SIGNATURE === 'true');

        if (requireSignature) {
          if (!sellerPublicKey || !signature) {
            res.status(401).json({
              success: false,
              code: 'UNAUTHORIZED',
              error: 'Cancellation requires seller proof of ownership (signature)',
            });
            return;
          }
        }

        if (signature) {
          if (!sellerPublicKey) {
            res.status(401).json({
              success: false,
              code: 'UNAUTHORIZED',
              error: 'Seller public key is required when providing a signature',
            });
            return;
          }

          const existingInvoice = await storage.getInvoiceById(req.params.id);
          if (!existingInvoice) {
            sendFailure(res, 404, 'Invoice not found');
            return;
          }

          if (existingInvoice.sellerPublicKey !== sellerPublicKey) {
            res.status(401).json({
              success: false,
              code: 'UNAUTHORIZED',
              error: 'Signer is not the seller of this invoice',
            });
            return;
          }

          const candidateMessages = [req.params.id, `cancel:${req.params.id}`];
          if (req.body?.message && typeof req.body.message === 'string') {
            candidateMessages.push(req.body.message);
          }

          const isValid = verifySellerSignature(sellerPublicKey, signature, candidateMessages);
          if (!isValid) {
            res.status(401).json({
              success: false,
              code: 'INVALID_SIGNATURE',
              error: 'Invalid signature for cancellation',
            });
            return;
          }
        }

        const invoice = await storage.cancelInvoice(req.params.id, sellerPublicKey);
        options.paymentMonitor?.unregisterWatch(req.params.id);
        sendSuccess(res, 200, invoice);
      } catch (error: any) {
        logError('Cancel invoice error:', error);
        const message = error.message || 'Failed to cancel invoice';
        const lowerMessage = message.toLowerCase();
        const isSellerMismatch = lowerMessage.includes('only the seller can cancel');
        const isUnauthorized = lowerMessage.includes('unauthorized');
        sendFailure(res, isSellerMismatch ? 403 : isUnauthorized ? 401 : 400, message);
      }
    },

    async verifyPayment(req: Request, res: Response) {
      try {
        const { id } = req.params;
        const { network } = req.body || {};

        // Per-invoice rate limit check (prevents Horizon amplification)
        const invoiceLimit = await checkInvoiceVerifyLimit(id);
        if (!invoiceLimit.allowed) {
          res.set('Retry-After', (invoiceLimit.retryAfter || 60).toString());
          return sendVerificationFailure(
            res,
            429,
            'VERIFY_RATE_LIMIT_EXCEEDED',
            'Too many verification attempts for this invoice'
          );
        }

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
        if (!statusCheck.ok && invoice.status !== 'CANCELLED') {
          return sendVerificationFailure(res, 400, statusCheck.code, statusCheck.error);
        }

        let txDetails;
        try {
          txDetails = await stellar.getTransaction(hashCheck.value);
        } catch (error: any) {
          logError('Verify payment lookup error:', error);
          const notFound = failure('TRANSACTION_NOT_FOUND');
          // Cache the rejection to prevent repeated Horizon lookups for invalid hashes
          await cacheVerificationResult(id, hashCheck.value, 'rejected', notFound.code);
          return sendVerificationFailure(res, 404, notFound.code, notFound.error);
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
          // Cache verification failures to prevent repeated attempts
          await cacheVerificationResult(id, hashCheck.value, 'rejected', verification.code);
          return sendVerificationFailure(res, 400, verification.code, verification.error);
        }

        if (invoice.status === 'CANCELLED' && !verification.value.settledAt) {
          return sendVerificationFailure(
            res,
            503,
            'TRANSACTION_CLOSE_TIME_UNAVAILABLE',
            messageForCode('TRANSACTION_CLOSE_TIME_UNAVAILABLE')
          );
        }

        let updatedInvoice: StoredInvoice;
        try {
          updatedInvoice = await storage.markAsPaid(
            id,
            verification.value.txHash,
            verification.value.from,
            payerCheck.value,
            { settledAt: verification.value.settledAt }
          );
          options.paymentMonitor?.unregisterWatch(id);
          
          // Cache successful verification
          await cacheVerificationResult(id, hashCheck.value, 'verified');
        } catch (error) {
          if (error instanceof PaymentClaimError) {
            // A transaction that already settled another invoice must not settle
            // this one as well. 409, not 400: the request is well formed and it
            // is the server's recorded state that refuses it.
            return sendVerificationFailure(res, 409, error.code, messageForCode(error.code));
          }
          if (error instanceof SettlementTimeUnavailableError) {
            return sendVerificationFailure(
              res,
              503,
              'TRANSACTION_CLOSE_TIME_UNAVAILABLE',
              messageForCode('TRANSACTION_CLOSE_TIME_UNAVAILABLE')
            );
          }
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

        sendSuccess(res, 200, updatedInvoice, {
          message: 'Payment verified on Stellar',
          code: updatedInvoice.latePaymentWarningCode,
          warning: updatedInvoice.latePaymentWarningCode
            ? warningForLatePayment(updatedInvoice.latePaymentWarningCode)
            : undefined,
        });
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
        const sellerCheck = stellarPublicKeySchema.safeParse(sellerPublicKey);
        if (!sellerCheck.success) {
          return sendFailure(res, 400, 'sellerPublicKey must be a valid Stellar public key');
        }

        const stats = await storage.getInvoiceStats(sellerCheck.data);
        sendSuccess(res, 200, stats);
      } catch (error: any) {
        logError('Get stats error:', error);
        sendFailure(res, 500, error.message || 'Failed to get statistics');
      }
    },

    // Local testing only — hidden unless ALLOW_SIMULATE=true.
    async simulatePayment(req: Request, res: Response) {
      if (cutoverDrainMode()) {
        return sendFailure(
          res,
          503,
          'System is in cutover drain mode. Payment simulation is temporarily paused.'
        );
      }
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
        options.paymentMonitor?.unregisterWatch(id);

        sendSuccess(res, 200, updatedInvoice, { message: 'Payment simulated successfully' });
      } catch (error: any) {
        logError('Simulate payment error:', error);
        sendFailure(res, 500, error.message || 'Failed to simulate payment');
      }
    },
  };
}

export default createInvoiceHandlers;
