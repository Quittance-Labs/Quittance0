import { CreateInvoiceInput } from '../utils/validation';
import type { InvoiceStats } from './invoice-stats';
import type { SettlementContext, LatePaymentWarningCode } from '../../../shared/invoice';

export type InvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

export interface StoredInvoice {
  id: string;
  userId?: string;
  sellerPublicKey: string;
  sellerName?: string;
  sellerEmail?: string;
  amount: number;
  /** Asset code for the invoice (e.g., 'XLM' or 'USDC'). */
  assetCode: string;
  /** Issuer public key for credit assets (omitted for native XLM). */
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
  createdAt: Date;
  paidAt?: Date;
  expiresAt: Date;
  cancelledAt?: Date;
  settlementContext?: SettlementContext;
  settledAt?: Date;
  priorStatus?: InvoiceStatus;
  latePaymentWarningCode?: LatePaymentWarningCode;
  metadata?: any;
}

export interface PayerInfo {
  payerName?: string;
  payerEmail?: string;
}

export interface MarkAsPaidOptions {
  settlementContext?: SettlementContext;
  settledAt?: Date;
  priorStatus?: InvoiceStatus;
  latePaymentWarningCode?: LatePaymentWarningCode;
  now?: Date;
}

/**
 * Storage adapter the shared invoice handlers run against.
 *
 * Both implementations are wallet-scoped: the seller public key always comes
 * from the invoice input or the caller's query, never from a static env key.
 */
export interface InvoiceStorage {
  /** Reported by /api/health so a running server tells you which backend it uses. */
  readonly mode: string;

  createInvoice(input: CreateInvoiceInput): Promise<StoredInvoice>;
  getInvoiceById(id: string): Promise<StoredInvoice | null>;
  getInvoicesBySeller(
    sellerPublicKey: string,
    status?: string,
    limit?: number,
    offset?: number
  ): Promise<StoredInvoice[]>;
  cancelInvoice(id: string, sellerPublicKey?: string): Promise<StoredInvoice>;
  markAsPaid(
    id: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: PayerInfo,
    options?: MarkAsPaidOptions
  ): Promise<StoredInvoice>;
  getInvoiceStats(sellerPublicKey: string): Promise<InvoiceStats[]>;
  /** Explicit maintenance hook; reads also apply this transition lazily. */
  markExpiredInvoices(now?: Date): Promise<number>;
  /** Total invoice count (for ceiling enforcement). */
  getInvoiceCount?(): Promise<number>;
}
