import { z } from 'zod';
import {
  DEFAULT_INVOICE_EXPIRY_DAYS,
  MAX_INVOICE_EXPIRY_DAYS,
  MIN_INVOICE_EXPIRY_DAYS,
} from '../domain/invoice-expiry';
import { NATIVE_ASSET_CODE, requiresIssuer } from './asset-helpers';

// Schemas used identically by both servers. Zod validates the create+verify
// payloads before they ever reach the InvoiceStorage layer, so the memory
// and Postgres backends receive the same seller name/email, assetCode +
// assetIssuer, customer name/email, expiresInDays and metadata fields.
// Stellar public key validation
export const stellarPublicKeySchema = z.string()
  .length(56)
  .regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar public key format');

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
    amount: z.number().positive().max(1000000000),
    assetCode: z.string().default('XLM').optional(),
    assetIssuer: stellarPublicKeySchema.optional(),
    description: z.string().max(500).optional(),
    customerName: z.string().max(255).optional(),
    customerEmail: z.string().email().optional(),
    sellerName: z.string().max(255).optional(),
    sellerEmail: z.string().email().optional(),
    expiresInDays: z.number()
      .int()
      .min(MIN_INVOICE_EXPIRY_DAYS)
      .max(MAX_INVOICE_EXPIRY_DAYS)
      .default(DEFAULT_INVOICE_EXPIRY_DAYS),
    sellerPublicKey: stellarPublicKeySchema,
  })
  .refine(
    (invoice) => !requiresIssuer(invoice.assetCode) || Boolean(invoice.assetIssuer),
    {
      path: ['assetIssuer'],
      message:
        'assetIssuer is required for issued assets; only XLM may omit it. An asset is identified by its code and issuer together.',
    },
  )
  .refine(
    (invoice) => invoice.assetCode !== NATIVE_ASSET_CODE || !invoice.assetIssuer,
    {
      path: ['assetIssuer'],
      message: 'XLM is the native asset and must not carry an issuer.',
    },
  );

// Payment verification schema
export const paymentSchema = z.object({
  invoiceId: z.string().uuid(),
  txHash: z.string().length(64),
  payerPublicKey: stellarPublicKeySchema,
  amount: z.number().positive(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;

export default {
  createInvoiceSchema,
  paymentSchema,
  stellarPublicKeySchema,
};
