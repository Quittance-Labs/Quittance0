// Handlers for both backends (in-memory and PostgreSQL). They take an
// InvoiceStorage implementation and do not branch on the storage mode, so a
// bug in one backend is a bug in both. All seller/payer/asset/customer/
// metadata/expiry fields pass through unchanged from the storage layer. The
// shared suite in invoice-handlers.test.ts runs these same handlers against
// both adapters with the same assertions to guarantee field parity.
import { Request, Response } from 'express';
import stellarService from '../services/stellar.service';
import {
  createInvoiceFieldErrors,
  createInvoiceSchema,
  stellarPublicKeySchema,
} from '../utils/validation';
import { firstCreateInvoiceMessage } from '../../../shared/invoice-validation';
import { toPublicInvoiceDto } from '../../../shared/invoice';
import { generatePaymentQR, generateStellarPaymentQR } from '../utils/qrcode';
import {
  apiSuccess,
  sendFailure,
  sendSuccess,
  sendValidationFailure,
  sendVerificationFailure,
  verificationFailureBody,
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
import { canonicalAmount } from '../utils/safe-amount-compare';
import { idempotencyKeyForCreate } from '../utils/idempotency';
import { createRequestId } from '../utils/request-correlation-id';
import { checkInvoiceVerifyLimit } from '../middleware/rate-limit';
import {
  verificationCache,
  type VerificationCache,
  type CachedVerificationBody,
} from '../middleware/verify-cache';
import { verifySellerSignature } from '../utils/signature-verification';
import { isHorizonUnavailable } from '../utils/horizon-client';
import { redactPaymentEventData } from '../utils/payment-event-redaction';

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
  /** Shared with the route's cache middleware; tests inject a controllable one. */
  verifyCache?: VerificationCache;
}

export interface InvoiceHandlers {
  createInvoice(req: Request, res: Response): Promise<void>;
  getInvoice(req: Request, res: Response): Promise<void>;
  getPaymentEvents(req: Request, res: Response): Promise<void>;
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
  const verifyCache = options.verifyCache ?? verificationCache;
  const cacheResult = (
    invoiceId: string,
    txHash: string,
    httpStatus: number,
    body: CachedVerificationBody
  ): Promise<void> =>
    verifyCache
      .set(invoiceId, txHash, httpStatus, body)
      .catch(error => console.error('[VerifyCache] Failed to cache result:', error));

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

    const stellarPayment = await generateStellarPaymentQR(
      invoice.sellerPublicKey,
      // The QR embeds the same stroop string the verifier compares —
      // `toString()` would emit `1e-7` for small amounts and fail the URI.
      canonicalAmount(invoice.amount) ?? invoice.amount.toString(),
      invoice.assetCode || 'XLM',
      invoice.memo,
      invoice.assetIssuer,
      paymentUrl
    );

    return {
      paymentAvailable: true,
      paymentUrl,
      statusPollingIntervalMs: PAYMENT_STATUS_POLL_INTERVAL_MS,
      qrCode: await generatePaymentQR(paymentUrl),
      stellarQrCode: stellarPayment.qrDataUrl,
      stellarUri: stellarPayment.uri,
      // False when the SEP-0007 URI outgrew the QR budget and the image
      // encodes the HTTPS pay link instead — the payer still gets the full
      // URI as copyable text.
      stellarQrEncodesUri: stellarPayment.encodesSep7Uri,
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
        // Issue #514: prefer the caller's Idempotency-Key header; fall back to
        // a derived signature inside its short window so even keyless retries
        // cannot mint a second pay link for the same intent.
        const headerKey = req.headers?.['idempotency-key'];
        if (typeof headerKey === 'string' && headerKey) {
          if (headerKey.length > 200 || !/^[A-Za-z0-9_:\-]+$/.test(headerKey)) {
            return sendFailure(res, 400, 'Idempotency-Key header is invalid');
          }
          validatedData.idempotencyKey = headerKey;
        }
        validatedData.idempotencyKey = idempotencyKeyForCreate(validatedData);
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
          stellarUri: payment.stellarUri,
          stellarQrEncodesUri: payment.stellarQrEncodesUri,
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

        // #503: two shapes from one record. The workspace (seller) fields —
        // customer contact, seller profile, payer identity, settlement
        // internals — only leave the server when the caller proves ownership
        // by presenting the invoice's own seller key. Everyone else gets the
        // public pay DTO.
        const sellerKey = req.query.sellerPublicKey;
        if (sellerKey !== undefined) {
          const parsed = stellarPublicKeySchema.safeParse(sellerKey);
          if (!parsed.success) {
            return sendFailure(res, 400, 'sellerPublicKey must be a valid Stellar public key');
          }
          if (parsed.data === invoice.sellerPublicKey) {
            return sendSuccess(res, 200, invoice);
          }
        }

        sendSuccess(res, 200, toPublicInvoiceDto(invoice));
      } catch (error: any) {
        logError('Get invoice error:', error);
        sendFailure(res, 500, error.message || 'Failed to get invoice');
      }
    },

    async getInvoices(req: Request, res: Response) {
      try {
        const { status, sellerPublicKey, q } = req.query;

        if (!sellerPublicKey) {
          return sendFailure(res, 400, 'sellerPublicKey query parameter is required');
        }
        const sellerCheck = stellarPublicKeySchema.safeParse(sellerPublicKey);
        if (!sellerCheck.success) {
          return sendFailure(res, 400, 'sellerPublicKey must be a valid Stellar public key');
        }

        const limit = toPositiveInt(req.query.limit, 50);
        const offset = toPositiveInt(req.query.offset, 0);
        const searchQuery = typeof q === 'string' && q.trim() ? q.trim() : undefined;

        const invoices = await storage.getInvoicesBySeller(
          sellerCheck.data,
          status as string | undefined,
          limit,
          offset,
          searchQuery
        );

        sendSuccess(res, 200, invoices, {
          pagination: { limit, offset, total: invoices.length },
        });
      } catch (error: any) {
        logError('Get invoices error:', error);
        sendFailure(res, 500, error.message || 'Failed to get invoices');
      }
    },

    /**
     * Seller-only audit feed for one invoice (issue #515). The workspace
     * timeline otherwise shows status timestamps only — a rejected
     * underpayment or foreign transaction never appears. The seller key
     * scopes the read the same way the cancel proof does: present the
     * invoice's own key or get nothing.
     */
    async getPaymentEvents(req: Request, res: Response) {
      try {
        const invoice = await storage.getInvoiceById(req.params.id);
        if (!invoice) {
          return sendFailure(res, 404, 'Invoice not found');
        }

        const sellerCheck = stellarPublicKeySchema.safeParse(req.query.sellerPublicKey);
        if (!sellerCheck.success) {
          return sendFailure(res, 400, 'sellerPublicKey query parameter is required and must be a valid Stellar public key');
        }
        if (sellerCheck.data !== invoice.sellerPublicKey) {
          return sendFailure(res, 403, 'Forbidden: not the seller of this invoice');
        }

        const events = (await storage.getPaymentEvents?.(invoice.id)) ?? [];
        sendSuccess(
          res,
          200,
          events.map((event) => ({
            id: event.id,
            invoiceId: event.invoiceId,
            eventType: event.eventType,
            eventData: redactPaymentEventData(event.eventData),
            createdAt: event.createdAt,
          }))
        );
      } catch (error: any) {
        logError('Get payment events error:', error);
        sendFailure(res, 500, error.message || 'Failed to get payment events');
      }
    },

    async getPaymentInfo(req: Request, res: Response) {
      try {
        const invoice = await storage.getInvoiceById(req.params.id);

        if (!invoice) {
          return sendFailure(res, 404, 'Invoice not found');
        }

        const payment = await buildPaymentPayload(invoice);

        sendSuccess(res, 200, { ...payment, invoice: toPublicInvoiceDto(invoice) });
      } catch (error: any) {
        logError('Get payment info error:', error);
        sendFailure(res, 500, error.message || 'Failed to get payment info');
      }
    },

    async cancelInvoice(req: Request, res: Response): Promise<void> {
      try {
        // Issue #517 — one proof path: the seller key, signature and message
        // all travel in the JSON body. Query params and headers are legacy
        // transports; when they carry a key that disagrees with the body the
        // request is ambiguous and fails closed.
        const bodyKeyRaw = req.body?.sellerPublicKey;
        const queryKeyRaw = req.query?.sellerPublicKey;
        const headerKeyRaw = req.headers?.['x-seller-public-key'];
        const alternates = [queryKeyRaw, headerKeyRaw]
          .flat()
          .filter((v): v is string => typeof v === 'string' && v.trim() !== '');

        let sellerPublicKey: string | undefined;
        if (typeof bodyKeyRaw === 'string' && bodyKeyRaw.trim() !== '') {
          const parsed = stellarPublicKeySchema.safeParse(bodyKeyRaw);
          if (!parsed.success) {
            return sendFailure(res, 400, 'Invalid Stellar public key format');
          }
          sellerPublicKey = parsed.data;
        }

        if (alternates.length > 0) {
          if (!sellerPublicKey) {
            return sendFailure(
              res,
              400,
              'Send sellerPublicKey in the request body; query and header keys are not accepted'
            );
          }
          for (const alt of alternates) {
            const parsed = stellarPublicKeySchema.safeParse(alt);
            if (!parsed.success || parsed.data !== sellerPublicKey) {
              return sendFailure(
                res,
                400,
                'Conflicting sellerPublicKey values between body, query, and header'
              );
            }
          }
        }

        if (!sellerPublicKey) {
          return sendFailure(
            res,
            401,
            'Unauthorized: sellerPublicKey is required to cancel an invoice'
          );
        }

        const signature =
          typeof req.body?.signature === 'string' && req.body.signature.trim() !== ''
            ? req.body.signature
            : undefined;

        // Signature is required in production and whenever the operator opts
        // in; the bypass exists for local dev/tests only (documented in
        // README — "Cancel authorization").
        const requireSignature =
          options.requireCancelSignature ??
          (process.env.REQUIRE_CANCEL_SIGNATURE === 'true' ||
            process.env.NODE_ENV === 'production');

        if (requireSignature && !signature) {
          res.status(401).json({
            success: false,
            code: 'UNAUTHORIZED',
            error: 'Cancellation requires a Freighter signature over cancel:<invoiceId>',
          });
          return;
        }

        if (signature) {
          const existingInvoice = await storage.getInvoiceById(req.params.id);
          if (!existingInvoice) {
            return sendFailure(res, 404, 'Invoice not found');
          }

          if (existingInvoice.sellerPublicKey !== sellerPublicKey) {
            return sendFailure(res, 403, 'Signer is not the seller of this invoice');
          }

          // One canonical message — the wallet signs exactly `cancel:<id>`.
          const isValid = verifySellerSignature(sellerPublicKey, signature, [
            `cancel:${req.params.id}`,
          ]);
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

        const verifyLimit = checkInvoiceVerifyLimit(id);
        if (!verifyLimit.allowed) {
          return sendVerificationFailure(
            res,
            429,
            'VERIFY_RATE_LIMIT_EXCEEDED',
            messageForCode('VERIFY_RATE_LIMIT_EXCEEDED')
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
        if (
          !statusCheck.ok &&
          invoice.status !== 'CANCELLED' &&
          invoice.status !== 'EXPIRED'
        ) {
          return sendVerificationFailure(res, 400, statusCheck.code, statusCheck.error);
        }

        let txDetails;
        try {
          txDetails = await stellar.getTransaction(hashCheck.value);
        } catch (error: any) {
          logError('Verify payment lookup error:', error);
          if (isHorizonUnavailable(error)) {
            // Horizon is overloaded or unreachable. A 503 invites the payer to
            // retry; it is never cached — caching an outage as a rejection
            // would poison the hash against later retries.
            const unavailable = failure('VERIFY_UNAVAILABLE');
            return sendVerificationFailure(res, 503, unavailable.code, unavailable.error);
          }
          const notFound = failure('TRANSACTION_NOT_FOUND');
          // Cached with the short negative TTL: the hash may be ahead of
          // Horizon indexing or the lookup may have failed transiently, and a
          // long cache entry would turn a retry into a permanent block.
          const body = verificationFailureBody(notFound.code, notFound.error);
          await cacheResult(id, hashCheck.value, 404, body);
          res.status(404).json(body);
          return;
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
          // Semantic rejections are permanent facts about the transaction —
          // safe to replay for the full expiry window.
          const body = verificationFailureBody(verification.code, verification.error);
          await cacheResult(id, hashCheck.value, 400, body);
          // Issue #515: a rejected verify lands on the seller's audit feed with
          // the same taxonomy the monitor uses, so "still PENDING" answers
          // itself without the payer having to say so.
          await storage.logPaymentEvent?.(
            id,
            verification.code === 'AMOUNT_TOO_LOW' || verification.code === 'AMOUNT_MISMATCH'
              ? 'PARTIAL_PAYMENT'
              : 'PAYMENT_REJECTED',
            {
              code: verification.code,
              txHash: hashCheck.value,
              source: 'manual-verify',
            }
          ).catch(() => undefined);
          return sendVerificationFailure(res, 400, verification.code, verification.error);
        }

        if (!verification.value.settledAt) {
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
            {
              settledAt: verification.value.settledAt,
              destinationMuxedId: verification.value.toMuxedId,
            }
          );
          options.paymentMonitor?.unregisterWatch(id);

          // PAID is terminal — the cached success replays for the full window.
          await cacheResult(
            id,
            hashCheck.value,
            200,
            apiSuccess(updatedInvoice, {
              message: 'Payment verified on Stellar',
              code: updatedInvoice.latePaymentWarningCode,
              warning: updatedInvoice.latePaymentWarningCode
                ? warningForLatePayment(updatedInvoice.latePaymentWarningCode)
                : undefined,
            })
          );
        } catch (error) {
          if (error instanceof PaymentClaimError) {
            // A transaction that already settled another invoice must not settle
            // this one as well. 409, not 400: the request is well formed and it
            // is the server's recorded state that refuses it. The conflict is a
            // stable fact about the tx hash, so it is safe to replay.
            const body = verificationFailureBody(error.code, messageForCode(error.code));
            await cacheResult(id, hashCheck.value, 409, body);
            res.status(409).json(body);
            return;
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
          if (
            latestStatus &&
            !latestStatus.ok &&
            latest!.status !== 'CANCELLED' &&
            latest!.status !== 'EXPIRED'
          ) {
            return sendVerificationFailure(
              res,
              400,
              latestStatus.code,
              latestStatus.error
            );
          }
          throw error;
        }

        sendSuccess(res, 200, toPublicInvoiceDto(updatedInvoice), {
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

        const updatedInvoice = await storage.markAsPaid(id, mockTxHash, mockPayerKey, undefined, {
          settledAt: new Date(),
        });
        options.paymentMonitor?.unregisterWatch(id);

        sendSuccess(res, 200, toPublicInvoiceDto(updatedInvoice), { message: 'Payment simulated successfully' });
      } catch (error: any) {
        logError('Simulate payment error:', error);
        sendFailure(res, 500, error.message || 'Failed to simulate payment');
      }
    },
  };
}

export default createInvoiceHandlers;
