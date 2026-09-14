import { MemoCollisionError } from '../domain/payment-attribution';
import { generateInvoiceMemo } from '../utils/memo';
import { generatePublicInvoiceId } from '../utils/memory-public-id';
import { CreateInvoiceInput } from '../utils/validation';
import memoryStorage, { MemoryStorage, MemoryPaymentEvent } from '../storage/memory-storage';
import { calculateInvoiceExpiry } from '../domain/invoice-expiry';
import type { StoredInvoice } from '../storage/invoice-storage';
import type { InvoiceStats } from '../storage/invoice-stats';
import type { PayerInfo, MarkAsPaidOptions } from '../storage/invoice-storage';

/**
 * How many times invoice creation re-draws a memo before giving up.
 *
 * A collision means another live invoice already holds that memo, which is how
 * one on-chain payment could otherwise be made to satisfy two invoices. Against
 * a per-millisecond random suffix a second draw is already generous; the point
 * of the bound is to fail loudly instead of looping.
 */
const MEMO_DRAW_ATTEMPTS = 3;

export class InvoiceMemoryService {
  constructor(
    private readonly storage: MemoryStorage = memoryStorage,
    /** Injectable so the collision path is testable without waiting for one. */
    private readonly nextMemo: () => string = generateInvoiceMemo
  ) {}

  async createInvoice(data: CreateInvoiceInput): Promise<StoredInvoice> {
    const expiresAt = calculateInvoiceExpiry(data.expiresInDays);

    let lastError: unknown;
    for (let attempt = 0; attempt < MEMO_DRAW_ATTEMPTS; attempt++) {
      const memo = this.nextMemo();
      try {
        const id = generatePublicInvoiceId();
        return this.storage.createInvoice({
          ...data,
          id,
          memo,
          expiresAt,
        });
      } catch (err) {
        if (err instanceof MemoCollisionError) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `Failed to generate unique memo after ${MEMO_DRAW_ATTEMPTS} attempts: ${
        (lastError as Error)?.message ?? 'collision'
      }`
    );
  }

  async getInvoiceById(id: string): Promise<StoredInvoice | null> {
    const invoice = this.storage.getInvoiceById(id);
    return invoice ?? null;
  }

  async getInvoiceByMemo(memo: string): Promise<StoredInvoice | null> {
    const invoice = this.storage.getInvoiceByMemo(memo);
    return invoice ?? null;
  }

  async markAsPaid(
    invoiceId: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: PayerInfo,
    options?: MarkAsPaidOptions
  ): Promise<StoredInvoice> {
    const invoice = this.storage.markAsPaid(invoiceId, txHash, payerPublicKey, payerInfo, options);

    if (!invoice) {
      throw new Error('Invoice not found, expired, or already processed');
    }

    console.log('✅ Invoice marked as paid:', invoiceId);
    return invoice;
  }

  async getInvoicesBySeller(
    sellerPublicKey: string,
    status?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<StoredInvoice[]> {
    let invoices = this.storage.getAllInvoices(status ? { status } : undefined);

    if (sellerPublicKey) {
      invoices = invoices.filter((inv) => inv.sellerPublicKey === sellerPublicKey);
    }

    return invoices.slice(offset, offset + limit);
  }

  async cancelInvoice(invoiceId: string, sellerPublicKey?: string): Promise<StoredInvoice> {
    const invoice = this.storage.getInvoiceById(invoiceId);

    if (!invoice || invoice.status !== 'PENDING') {
      throw new Error('Invoice not found or already processed');
    }

    if (sellerPublicKey && invoice.sellerPublicKey !== sellerPublicKey) {
      throw new Error('Unauthorized: only the seller can cancel this invoice');
    }

    const updated = this.storage.updateInvoice(invoiceId, { status: 'CANCELLED', cancelledAt: new Date() });
    if (!updated) {
      throw new Error('Invoice not found or already processed');
    }
    return updated;
  }

  async markExpiredInvoices(now?: Date): Promise<number> {
    return this.storage.markExpiredInvoices(now);
  }

  async getInvoiceStats(sellerPublicKey: string): Promise<InvoiceStats[]> {
    return [this.storage.getStats(sellerPublicKey)];
  }

  async getInvoiceCount(): Promise<number> {
    return this.storage.getInvoiceCount();
  }

  async logPaymentEvent(invoiceId: string, eventType: string, eventData: any): Promise<void> {
    this.storage.logPaymentEvent(invoiceId, eventType, eventData);
  }
}

export default new InvoiceMemoryService();
