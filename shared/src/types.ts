/**
 * Canonical types for Quittance Invoice API contracts across backend and frontend.
 */

export type InvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

export interface Invoice {
  id: string;
  userId?: string;
  sellerPublicKey: string;
  sellerName?: string;
  sellerEmail?: string;
  amount: number;
  assetCode: string;
  assetIssuer?: string;
  memo: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  status: InvoiceStatus;
  paymentTxHash?: string;
  payerPublicKey?: string;
  payerName?: string;
  payerEmail?: string;
  createdAt: Date | string;
  paidAt?: Date | string;
  expiresAt: Date | string;
  metadata?: Record<string, unknown> | null;
}

export interface PaymentDetails {
  id: string;
  from: string;
  to: string;
  amount: string;
  assetCode: string;
  memo?: string;
  createdAt: string;
  transactionHash: string;
}

export interface VerifyResult {
  valid: boolean;
  invoice?: Invoice;
  txHash?: string;
  payment?: PaymentDetails;
  error?: string;
  message?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface CreateInvoiceRequest {
  amount: number;
  assetCode?: string;
  assetIssuer?: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  sellerName?: string;
  sellerEmail?: string;
  expiresInDays?: number;
  sellerPublicKey: string;
}

export type CreateInvoiceInput = CreateInvoiceRequest;

export interface VerifyPaymentRequest {
  invoiceId: string;
  txHash: string;
  payerPublicKey: string;
  amount: number;
  payerName?: string;
  payerEmail?: string;
}

export type PaymentInput = VerifyPaymentRequest;

export interface InvoiceStats {
  total_invoices: number;
  paid_invoices: number;
  pending_invoices: number;
  expired_invoices: number;
  cancelled_invoices?: number;
  revenue_by_asset: Record<string, number>;
}

export interface PaymentInfo {
  paymentUrl: string;
  qrCode?: string;
  stellarQrCode?: string;
  invoice: Invoice;
}
