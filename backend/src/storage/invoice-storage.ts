import { CreateInvoiceInput } from '../utils/validation';
import type { InvoiceStats } from './invoice-stats';

// Shared shape and shared storage contract. Both MemoryInvoiceStorage and
// PostgresInvoiceStorage implement these 8 methods with the same semantics,
// and every invoice they return is the StoredInvoice type below. Behaviour
// parity (expiry guard on markAsPaid, single-transition PENDING->CANCELLED,
// PENDING->PAID only when expiresAt still in the future, lazy
// markExpiredInvoices on all reads, strict seller_public_key scoping on list
// and stats) is pinned by the shared test suite in invoice-handlers.test.ts.
export type InvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

// Invoice shape shared by both storage backends.
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
  /** Explicit maintenance hook; reads also apply this transition lazily. */
  markExpiredInvoices(now?: Date): Promise<number>;
}
