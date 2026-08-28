import { z } from 'zod';

/**
 * Stellar public key validation (56 chars, G prefix, base32)
 */
export const stellarPublicKeySchema = z.string()
  .length(56, 'Stellar public key must be exactly 56 characters')
  .regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar public key format');

/**
 * Invoice status enum schema
 */
export const invoiceStatusSchema = z.enum(['PENDING', 'PAID', 'EXPIRED', 'CANCELLED']);

/**
 * Invoice creation input schema
 */
export const createInvoiceSchema = z.object({
  amount: z.number().positive('Amount must be positive').max(1000000000, 'Amount exceeds maximum limit'),
  assetCode: z.string().default('XLM').optional(),
  assetIssuer: z.string().optional(),
  description: z.string().max(500, 'Description cannot exceed 500 characters').optional(),
  customerName: z.string().max(255, 'Customer name cannot exceed 255 characters').optional(),
  customerEmail: z.string().email('Invalid customer email address').optional().or(z.literal('')),
  sellerName: z.string().max(255, 'Seller name cannot exceed 255 characters').optional(),
  sellerEmail: z.string().email('Invalid seller email address').optional().or(z.literal('')),
  expiresInDays: z.number().min(1, 'Expiration must be at least 1 day').max(365, 'Expiration cannot exceed 365 days').default(7).optional(),
  sellerPublicKey: stellarPublicKeySchema,
});

/**
 * Payment verification input schema
 */
export const paymentSchema = z.object({
  invoiceId: z.string().uuid('Invalid invoice ID format'),
  txHash: z.string().length(64, 'Transaction hash must be 64 characters'),
  payerPublicKey: stellarPublicKeySchema,
  amount: z.number().positive('Payment amount must be positive'),
  payerName: z.string().max(255).optional(),
  payerEmail: z.string().email('Invalid payer email address').optional().or(z.literal('')),
});

export const verifyPaymentSchema = paymentSchema;

/**
 * Full canonical Invoice schema
 */
export const invoiceSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  sellerPublicKey: stellarPublicKeySchema,
  sellerName: z.string().optional(),
  sellerEmail: z.string().optional(),
  amount: z.number().positive(),
  assetCode: z.string(),
  assetIssuer: z.string().optional(),
  memo: z.string(),
  description: z.string().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().optional(),
  status: invoiceStatusSchema,
  paymentTxHash: z.string().optional(),
  payerPublicKey: z.string().optional(),
  payerName: z.string().optional(),
  payerEmail: z.string().optional(),
  createdAt: z.union([z.date(), z.string()]),
  paidAt: z.union([z.date(), z.string()]).optional(),
  expiresAt: z.union([z.date(), z.string()]),
  metadata: z.record(z.unknown()).nullable().optional(),
});

/**
 * Verification result schema
 */
export const verifyResultSchema = z.object({
  valid: z.boolean(),
  invoice: invoiceSchema.optional(),
  txHash: z.string().optional(),
  payment: z.object({
    id: z.string(),
    from: z.string(),
    to: z.string(),
    amount: z.string(),
    assetCode: z.string(),
    memo: z.string().optional(),
    createdAt: z.string(),
    transactionHash: z.string(),
  }).optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

/**
 * Generic API response schema builder
 */
export const createApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  });

export const apiResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});
