import { z } from 'zod';
import {
  DEFAULT_INVOICE_EXPIRY_DAYS,
  MAX_INVOICE_EXPIRY_DAYS,
  MIN_INVOICE_EXPIRY_DAYS,
} from '../domain/invoice-expiry';
import { NATIVE_ASSET_CODE, requiresIssuer } from './asset-helpers';
import {
  CREATE_INVOICE_MESSAGES,
  MAX_DESCRIPTION_LENGTH,
  MAX_INVOICE_AMOUNT,
  MAX_NAME_LENGTH,
  isStellarPublicKey,
  isValidEmail,
} from '../../../shared/invoice-validation';
import { SUPPORTED_STELLAR_NETWORKS } from '../config/stellar';

// Schemas used identically by both servers. Zod validates the create+verify
// payloads before they ever reach the InvoiceStorage layer, so the memory
// and Postgres backends receive the same seller name/email, assetCode +
// assetIssuer, customer name/email, expiresInDays and metadata fields.
// Rejections are serialized through the shared failure envelope
// (`{ success:false, error }`) from types/api.ts, matching the verify path's
// `code` + `error` shape so every client reads one consistent contract.
// Stellar public key validation
export const stellarPublicKeySchema = z
  .string({ invalid_type_error: CREATE_INVOICE_MESSAGES.publicKeyFormat })
  .refine(isStellarPublicKey, CREATE_INVOICE_MESSAGES.publicKeyFormat);

/**
 * Invoice creation schema.
 *
 * A credit asset must carry its issuer (issue #246). Without one the invoice
 * names an asset nobody pinned, which verification refuses to settle — so
 * accepting it at creation would only produce an invoice that can never be
 * paid. `XLM` is the exception: it is the native asset and has no issuer.
 */
export const createInvoiceSchema = z
  .object({
    amount: z
      .number({
        required_error: CREATE_INVOICE_MESSAGES.amountRequired,
        invalid_type_error: CREATE_INVOICE_MESSAGES.amountNotNumber,
      })
      .positive(CREATE_INVOICE_MESSAGES.amountPositive)
      .max(MAX_INVOICE_AMOUNT, CREATE_INVOICE_MESSAGES.amountTooLarge)
      .refine(Number.isFinite, CREATE_INVOICE_MESSAGES.amountNotFinite),
    assetCode: z.string().default('XLM').transform((val) => val.toUpperCase()).optional(),
    assetIssuer: stellarPublicKeySchema.optional(),
    description: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH, CREATE_INVOICE_MESSAGES.description)
      .optional(),
    customerName: z
      .string()
      .max(MAX_NAME_LENGTH, CREATE_INVOICE_MESSAGES.customerName)
      .optional(),
    customerEmail: z
      .string()
      .refine(isValidEmail, CREATE_INVOICE_MESSAGES.customerEmail)
      .optional(),
    sellerName: z
      .string()
      .max(MAX_NAME_LENGTH, CREATE_INVOICE_MESSAGES.sellerName)
      .optional(),
    sellerEmail: z
      .string()
      .refine(isValidEmail, CREATE_INVOICE_MESSAGES.sellerEmail)
      .optional(),
    network: z
      .enum(SUPPORTED_STELLAR_NETWORKS, {
        errorMap: () => ({ message: CREATE_INVOICE_MESSAGES.network }),
      })
      .optional(),
    expiresInDays: z
      .number()
      .int(CREATE_INVOICE_MESSAGES.expiresInDays)
      .min(MIN_INVOICE_EXPIRY_DAYS, CREATE_INVOICE_MESSAGES.expiresInDays)
      .max(MAX_INVOICE_EXPIRY_DAYS, CREATE_INVOICE_MESSAGES.expiresInDays)
      .default(DEFAULT_INVOICE_EXPIRY_DAYS),
    sellerPublicKey: z
      .string({
        required_error: CREATE_INVOICE_MESSAGES.sellerPublicKeyRequired,
        invalid_type_error: CREATE_INVOICE_MESSAGES.sellerPublicKeyRequired,
      })
      .refine(isStellarPublicKey, CREATE_INVOICE_MESSAGES.publicKeyFormat),
    idempotencyKey: z
      .string()
      .max(200)
      .regex(/^[A-Za-z0-9_:\-]+$/, 'idempotencyKey must be URL-safe')
      .optional(),
  })
  .refine(
    (invoice) => !requiresIssuer(invoice.assetCode) || Boolean(invoice.assetIssuer),
    {
      path: ['assetIssuer'],
      message: CREATE_INVOICE_MESSAGES.assetIssuerRequired,
    },
  )
  .refine(
    (invoice) => invoice.assetCode !== NATIVE_ASSET_CODE || !invoice.assetIssuer,
    {
      path: ['assetIssuer'],
      message: CREATE_INVOICE_MESSAGES.assetIssuerNotAllowed,
    },
  );

// Payment verification schema
export const paymentSchema = z.object({
  invoiceId: z.string().uuid(),
  txHash: z.string().length(64),
  payerPublicKey: stellarPublicKeySchema,
  amount: z.number().positive(),
});

// Invoice cancellation schema
export const cancelInvoiceSchema = z.object({
  sellerPublicKey: stellarPublicKeySchema.optional(),
});

/**
 * The failed payload as a field -> message map.
 *
 * Zod reports issues, not fields: the caller used to serialize the whole
 * issue list into one error string, which a client cannot attach to an
 * input. The first issue per field wins, and an issue with no path (the
 * object-level refinements) lands under 'form', so nothing is dropped.
 */
export function createInvoiceFieldErrors(
  error: z.ZodError
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    const key = typeof issue.path[0] === 'string' ? issue.path[0] : 'form';
    if (!fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }

  return fieldErrors;
}

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;

export default {
  createInvoiceSchema,
  paymentSchema,
  cancelInvoiceSchema,
  stellarPublicKeySchema,
};
