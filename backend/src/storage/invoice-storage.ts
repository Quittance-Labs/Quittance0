import { CreateInvoiceInput } from '../utils/validation';
import type { InvoiceStats } from './invoice-stats';

export type InvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

// Invoice shape shared by both storage backends.
export interface StoredInvoice {
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
  createdAt: Date;
  paidAt?: Date;
  expiresAt: Date;
  metadata?: any;
}

export interface PayerInfo {
  payerName?: string;
  payerEmail?: string;
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
  cancelInvoice(id: string): Promise<StoredInvoice>;
  markAsPaid(
    id: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: PayerInfo
  ): Promise<StoredInvoice>;
  getInvoiceStats(sellerPublicKey: string): Promise<InvoiceStats[]>;
}
