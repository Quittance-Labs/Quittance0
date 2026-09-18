// Handlers for both backends (in-memory and PostgreSQL). They take an
// InvoiceStorage implementation and do not branch on the storage mode, so a
// bug in one backend is a bug in both. All seller/payer/asset/customer/
// metadata/expiry fields pass through unchanged from the storage layer. The
// shared suite in invoice-handlers.test.ts runs these same handlers against
// both adapters with the same assertions to guarantee field parity.
import { randomBytes } from 'node:crypto';
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
import {
  createRequestId,
  getRequestCorrelationId,
} from '../utils/request-correlation-id';
import {
  emitEvent,
  logReference,
  LogContext,
} from '../observability/log-events';
import { checkInvoiceVerifyLimit } from '../middleware/rate-limit';
import { cacheVerificationResult } from '../middleware/verify-cache';
import { verifySellerSignature } from '../utils/signature-verification';

/** Kept explicit so clients can tune polling without duplicating backend policy. */
export const PAYMENT_STATUS_POLL_INTERVAL_MS = 3000;

/** Only the part of the Stellar service the verify handler needs. */
export interface TransactionLookup {
  getTransaction(txHash: string): Promise<any>;
}

export interface InvoiceHandlerOptions {
  storage: InvoiceStorage;
  /** Defaults to FRONTEND_URL, read per request so tests and dev reloads see changes. */
  frontendUrl?: string;
  /** Optional local-test override. Production always forces simulation off. */
  allowSimulate?: boolean;
  stellar?: TransactionLookup;
  requireCancelSignature?: boolean;
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
  const message = error?.message || (typeof error === 'string' ? error : 'Unknown error');
  console.error(`${prefix}${label} ${message}`);
}

function getRequestContext(req: Request): LogContext {
  const requestId =
    (req as any).id ||
    (req as any).requestId ||
    getRequestCorrelationId() ||
    createRequestId();
  return {
    requestId,
    service: 'api',
    environment: process.env.NODE_ENV || 'development',
  };
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Invoice route handlers shared by the MVP (in-memory) and Postgres servers.
 * The only difference between the two entrypoints is the storage adapter.
 */
export function createInvoiceHandlers(options: InvoiceHandlerOptions | InvoiceStorage): InvoiceHandlers {
  const normalizedOptions: InvoiceHandlerOptions =
    typeof (options as any)?.createInvoice === 'function'
      ? { storage: options as InvoiceStorage }
      : (options as InvoiceHandlerOptions);
  const { storage } = normalizedOptions;
  const storageMode = storage?.mode || 'in-memory';
  const stellar: TransactionLookup = normalizedOptions.stellar || stellarService;

  const frontendUrl = () =>
    normalizedOptions.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000';

  const simulateAllowed = () =>
    process.env.NODE_ENV !== 'production' && (
      normalizedOptions.allowSimulate !== undefined
        ? normalizedOptions.allowSimulate
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
      const startTime = Date.now();
      const context = getRequestContext(req);
      const { requestId } = context;

      if (cutoverDrainMode()) {
        emitEvent('warn', 'invoice.create.rejected', context, {
          errorCode: 'CUTOVER_DRAIN',
          storage: storageMode,
          durationMs: Date.now() - startTime,
        });
        return sendFailure(
          res,
          503,
          'System is in cutover drain mode. New invoice creation is temporarily paused.'
        );
      }
      try {
        const parsed = createInvoiceSchema.safeParse(req.body);
        if (!parsed.success) {
          const fieldErrors = createInvoiceFieldErrors(parsed.error);
          emitEvent('warn', 'invoice.create.rejected', context, {
            sellerRef: req.body?.sellerPublicKey ? logReference(req.body.sellerPublicKey) : undefined,
            errorCode: 'VALIDATION_ERROR',
            storage: storageMode,
            durationMs: Date.now() - startTime,
          });
          return sendValidationFailure(
            res,
            firstCreateInvoiceMessage(fieldErrors) || 'Invalid invoice payload',
            fieldErrors
          );
        }
        const validatedData = parsed.data;
        if (validatedData.network && validatedData.network !== STELLAR_NETWORK) {
          emitEvent('warn', 'invoice.create.rejected', context, {
            sellerRef: logReference(validatedData.sellerPublicKey),
            errorCode: 'NETWORK_MISMATCH',
            network: validatedData.network,
            storage: storageMode,
            durationMs: Date.now() - startTime,
          });
          return sendFailure(res, 400, 'Client wallet network does not match the server Stellar network');
        }

        emitEvent('info', 'invoice.create.started', context, {
          sellerRef: logReference(validatedData.sellerPublicKey),
          assetCode: validatedData.assetCode,
          network: validatedData.network || STELLAR_NETWORK,
          storage: storageMode,
        });

        const invoice = await storage.createInvoice(validatedData);
        const payment = await buildPaymentPayload(invoice);

        emitEvent('info', 'invoice.create.succeeded', context, {
          sellerRef: logReference(invoice.sellerPublicKey),
          invoiceRef: logReference(invoice.id),
          assetCode: invoice.assetCode,
          network: STELLAR_NETWORK,
          storage: storageMode,
          durationMs: Date.now() - startTime,
        });

        sendSuccess(res, 201, {
          invoice,
          paymentAvailable: payment.paymentAvailable,
          paymentUrl: payment.paymentUrl,
          statusPollingIntervalMs: payment.statusPollingIntervalMs,
          qrCode: payment.qrCode,
          stellarQrCode: payment.stellarQrCode,
        });
      } catch (error: any) {
        emitEvent('warn', 'invoice.create.rejected', context, {
          sellerRef: req.body?.sellerPublicKey ? logReference(req.body.sellerPublicKey) : undefined,
          errorCode: 'CREATE_FAILED',
          storage: storageMode,
          durationMs: Date.now() - startTime,
        });
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
      const startTime = Date.now();
      const context = getRequestContext(req);
      const { requestId } = context;

      try {
        const { id } = req.params;
        const { network } = req.body || {};

        // Per-invoice rate limit check (prevents Horizon amplification)
        const invoiceLimit = await checkInvoiceVerifyLimit(id);
        if (!invoiceLimit.allowed) {
          emitEvent('warn', 'payment.verify.rejected', context, {
            invoiceRef: logReference(id),
            errorCode: 'VERIFY_RATE_LIMIT_EXCEEDED',
            network: network || STELLAR_NETWORK,
            durationMs: Date.now() - startTime,
          });
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
          emitEvent('warn', 'payment.verify.rejected', context, {
            invoiceRef: logReference(id),
            errorCode: hashCheck.code,
            network: network || STELLAR_NETWORK,
            durationMs: Date.now() - startTime,
          });
          return sendVerificationFailure(res, 400, hashCheck.code, hashCheck.error);
        }

        const payerCheck = checkPayerInfo(req.body);
        if (!payerCheck.ok) {
          emitEvent('warn', 'payment.verify.rejected', context, {
            invoiceRef: logReference(id),
            txRef: logReference(hashCheck.value),
            errorCode: payerCheck.code,
            network: network || STELLAR_NETWORK,
            durationMs: Date.now() - startTime,
          });
          return sendVerificationFailure(res, 400, payerCheck.code, payerCheck.error);
        }

        const invoice = await storage.getInvoiceById(id);

        if (!invoice) {
          emitEvent('warn', 'payment.verify.rejected', context, {
            invoiceRef: logReference(id),
            txRef: logReference(hashCheck.value),
            errorCode: 'INVOICE_NOT_FOUND',
            network: network || STELLAR_NETWORK,
            durationMs: Date.now() - startTime,
          });
          return sendFailure(res, 404, 'Invoice not found');
        }

        const statusCheck = checkInvoiceIsPayable(invoice.status);
        if (!statusCheck.ok && invoice.status !== 'CANCELLED') {
          emitEvent('warn', 'payment.verify.rejected', context, {
            invoiceRef: logReference(id),
            txRef: logReference(hashCheck.value),
            errorCode: statusCheck.code,
            network: network || STELLAR_NETWORK,
            durationMs: Date.now() - startTime,
          });
          return sendVerificationFailure(res, 400, statusCheck.code, statusCheck.error);
        }

        emitEvent('info', 'payment.verify.started', context, {
          invoiceRef: logReference(id),
          txRef: logReference(hashCheck.value),
          network: network || STELLAR_NETWORK,
        });

        let txDetails;
        try {
          txDetails = await stellar.getTransaction(hashCheck.value);
        } catch (error: any) {
          logError('Verify payment lookup error:', error, requestId);
          const isOutage =
            error?.response?.status === 503 ||
            error?.response?.status === 502 ||
            error?.response?.status === 504 ||
            error?.code === 'ECONNREFUSED' ||
            error?.code === 'ETIMEDOUT' ||
            error?.code === 'ENOTFOUND' ||
            (typeof error?.response?.status === 'number' && error.response.status >= 500);

          if (isOutage) {
            emitEvent('error', 'horizon.request.failed', context, {
              operation: 'getTransaction',
              errorCode: 'HORIZON_UNAVAILABLE',
              network: network || STELLAR_NETWORK,
              attempt: 1,
              durationMs: Date.now() - startTime,
            });
            emitEvent('warn', 'payment.verify.rejected', context, {
              invoiceRef: logReference(id),
              txRef: logReference(hashCheck.value),
              errorCode: 'HORIZON_UNAVAILABLE',
              network: network || STELLAR_NETWORK,
              durationMs: Date.now() - startTime,
            });
            return sendVerificationFailure(
              res,
              503,
              'HORIZON_UNAVAILABLE',
              'Stellar Horizon service is temporarily unavailable'
            );
          }

          const notFound = failure('TRANSACTION_NOT_FOUND');
          emitEvent('warn', 'payment.verify.rejected', context, {
            invoiceRef: logReference(id),
            txRef: logReference(hashCheck.value),
            errorCode: notFound.code,
            network: network || STELLAR_NETWORK,
            durationMs: Date.now() - startTime,
          });
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
          emitEvent('warn', 'payment.verify.rejected', context, {
            invoiceRef: logReference(id),
            txRef: logReference(hashCheck.value),
            errorCode: verification.code,
            network: network || STELLAR_NETWORK,
            durationMs: Date.now() - startTime,
          });
          // Cache verification failures to prevent repeated attempts
          await cacheVerificationResult(id, hashCheck.value, 'rejected', verification.code);
          return sendVerificationFailure(res, 400, verification.code, verification.error);
        }

        if (invoice.status === 'CANCELLED' && !verification.value.settledAt) {
          emitEvent('warn', 'payment.verify.rejected', context, {
            invoiceRef: logReference(id),
            txRef: logReference(hashCheck.value),
            errorCode: 'TRANSACTION_CLOSE_TIME_UNAVAILABLE',
            network: network || STELLAR_NETWORK,
            durationMs: Date.now() - startTime,
          });
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
          
          // Cache successful verification
          await cacheVerificationResult(id, hashCheck.value, 'verified');

          emitEvent('info', 'invoice.paid', context, {
            invoiceRef: logReference(id),
            sellerRef: logReference(updatedInvoice.sellerPublicKey),
            txRef: logReference(verification.value.txHash),
            assetCode: updatedInvoice.assetCode,
            network: STELLAR_NETWORK,
            storage: storageMode,
            durationMs: Date.now() - startTime,
          });
        } catch (error) {
          if (error instanceof PaymentClaimError) {
            emitEvent('warn', 'payment.verify.rejected', context, {
              invoiceRef: logReference(id),
              txRef: logReference(verification.value.txHash),
              errorCode: error.code,
              network: STELLAR_NETWORK,
              durationMs: Date.now() - startTime,
            });
            // A transaction that already settled another invoice must not settle
            // this one as well. 409, not 400: the request is well formed and it
            // is the server's recorded state that refuses it.
            return sendVerificationFailure(res, 409, error.code, messageForCode(error.code));
          }
          if (error instanceof SettlementTimeUnavailableError) {
            emitEvent('warn', 'payment.verify.rejected', context, {
              invoiceRef: logReference(id),
              txRef: logReference(verification.value.txHash),
              errorCode: 'TRANSACTION_CLOSE_TIME_UNAVAILABLE',
              network: STELLAR_NETWORK,
              durationMs: Date.now() - startTime,
            });
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
            emitEvent('warn', 'payment.verify.rejected', context, {
              invoiceRef: logReference(id),
              txRef: logReference(verification.value.txHash),
              errorCode: latestStatus.code,
              network: STELLAR_NETWORK,
              durationMs: Date.now() - startTime,
            });
            return sendVerificationFailure(
              res,
              400,
              latestStatus.code,
              latestStatus.error
            );
          }
          emitEvent('warn', 'payment.verify.rejected', context, {
            invoiceRef: logReference(id),
            txRef: logReference(verification.value.txHash),
            errorCode: 'SETTLEMENT_ERROR',
            network: STELLAR_NETWORK,
            durationMs: Date.now() - startTime,
          });
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
        emitEvent('warn', 'payment.verify.rejected', context, {
          invoiceRef: req.params?.id ? logReference(req.params.id) : undefined,
          errorCode: 'VERIFY_FAILED',
          network: req.body?.network || STELLAR_NETWORK,
          durationMs: Date.now() - startTime,
        });
        logError('Verify payment error:', error, requestId);
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

        const startTime = Date.now();
        const context = getRequestContext(req);
        emitEvent('info', 'payment.attempt.started', context, {
          invoiceRef: logReference(invoice.id),
          network: STELLAR_NETWORK,
        });

        const mockTxHash =
          req.body?.txHash && /^[a-fA-F0-9]{64}$/.test(req.body.txHash)
            ? req.body.txHash.toLowerCase()
            : randomBytes(32).toString('hex');
        const mockPayerKey =
          req.body?.sourceAccount && /^G[A-Z2-7]{55}$/.test(req.body.sourceAccount)
            ? req.body.sourceAccount
            : 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';

        emitEvent('info', 'payment.attempt.submitted', context, {
          invoiceRef: logReference(invoice.id),
          txRef: logReference(mockTxHash),
          network: STELLAR_NETWORK,
          durationMs: Date.now() - startTime,
        });

        const updatedInvoice = await storage.markAsPaid(id, mockTxHash, mockPayerKey);

        emitEvent('info', 'invoice.paid', context, {
          invoiceRef: logReference(invoice.id),
          sellerRef: logReference(updatedInvoice.sellerPublicKey),
          txRef: logReference(mockTxHash),
          assetCode: updatedInvoice.assetCode,
          network: STELLAR_NETWORK,
          storage: storageMode,
          durationMs: Date.now() - startTime,
        });

        sendSuccess(res, 200, updatedInvoice, { message: 'Payment simulated successfully' });
      } catch (error: any) {
        logError('Simulate payment error:', error);
        sendFailure(res, 500, error.message || 'Failed to simulate payment');
      }
    },
  };
}

export default createInvoiceHandlers;
