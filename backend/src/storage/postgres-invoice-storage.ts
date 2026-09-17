import invoiceService, { InvoiceService } from '../services/invoice.service';
import { CreateInvoiceInput } from '../utils/validation';
import type { InvoiceStats } from './invoice-stats';
import type { InvoiceStorage, MarkAsPaidOptions, PayerInfo, StoredInvoice } from './invoice-storage';

/**
 * PostgreSQL storage backend. Same contract as the in-memory backend, but the
 * invoices survive restarts. Field parity with the memory backend is enforced
 * through the shared StoredInvoice interface: every column the Postgres path
 * writes (seller_email, asset_issuer, payer_name/email, expires_at, metadata,
 * paid_at, cancellation and settlement context fields) is matched by the same
 * field name in MemoryStorage. Behavioural parity (expires_at > NOW() guard
 * for normal PENDING settlement, cancel-aware late settlement, seller-scoped
 * list+stats, PENDING-only cancel) is enforced by the SQL WHERE clauses
 * mirroring the branches in memory-storage.ts.
 */
export class PostgresInvoiceStorage implements InvoiceStorage {
  readonly mode = 'postgres';

  constructor(private readonly service: InvoiceService = invoiceService) {}

  async createInvoice(input: CreateInvoiceInput): Promise<StoredInvoice> {
    return this.service.createInvoice(input);
  }

  async getInvoiceById(id: string): Promise<StoredInvoice | null> {
    return this.service.getInvoiceById(id);
  }

  async getInvoicesBySeller(
    sellerPublicKey: string,
    status?: string,
    limit = 50,
    offset = 0,
    q?: string
  ): Promise<StoredInvoice[]> {
    return this.service.getInvoicesBySeller(sellerPublicKey, status, limit, offset, q);
  }

  async cancelInvoice(id: string, sellerPublicKey?: string): Promise<StoredInvoice> {
    return this.service.cancelInvoice(id, sellerPublicKey);
  }

  async markAsPaid(
    id: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: PayerInfo,
    options?: MarkAsPaidOptions
  ): Promise<StoredInvoice> {
    return this.service.markAsPaid(id, txHash, payerPublicKey, payerInfo, options);
  }

  async getInvoiceStats(sellerPublicKey: string): Promise<InvoiceStats[]> {
    return this.service.getInvoiceStats(sellerPublicKey);
  }

  async markExpiredInvoices(now?: Date): Promise<number> {
    return this.service.markExpiredInvoices(now);
  }

  async countInvoices(): Promise<number> {
    return this.service.countInvoices();
  }
}

export default new PostgresInvoiceStorage();
