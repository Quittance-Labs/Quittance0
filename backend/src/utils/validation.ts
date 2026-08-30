import { z } from 'zod';
import {
  DEFAULT_INVOICE_EXPIRY_DAYS,
  MAX_INVOICE_EXPIRY_DAYS,
  MIN_INVOICE_EXPIRY_DAYS,
} from '../domain/invoice-expiry';

// Stellar public key validation
export const stellarPublicKeySchema = z.string()
  .length(56)
  .regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar public key format');

// Invoice creation schema
export const createInvoiceSchema = z.object({
  amount: z.number().positive().max(1000000000),
  assetCode: z.string().default('XLM').optional(),
  assetIssuer: z.string().optional(),
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
  sellerPublicKey: stellarPublicKeySchema, // Dinamik seller!
});

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
