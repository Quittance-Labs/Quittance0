import { MemoCollisionError } from '../domain/payment-attribution';
import { generateInvoiceMemo } from '../utils/memo';
import { generatePublicInvoiceId } from '../utils/memory-public-id';
import { CreateInvoiceInput } from '../utils/validation';
import memoryStorage, { MemoryStorage, MemoryPaymentEvent } from '../storage/memory-storage';
import { calculateInvoiceExpiry } from '../domain/invoice-expiry';
import type { StoredInvoice } from '../storage/invoice-storage';
import type { InvoiceStats } from '../storage/invoice-stats';
import type { MarkAsPaidOptions, PayerInfo } from '../storage/invoice-storage';
import { IllegalStateTransitionError } from '../domain/invoice-lifecycle';
import { SettlementTimeUnavailableError } from '../domain/invoice-settlement';

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

  async createInvoice(input: CreateInvoiceInput): Promise<StoredInvoice> {
    if (!input.sellerPublicKey) {
      throw new Error('Seller public key is required');
    }

    const id = generatePublicInvoiceId();
    const memo = this.drawUnusedMemo();
    const expiresAt = calculateInvoiceExpiry(input.expiresInDays);

    const invoice = this.storage.createInvoice({
      id,
      sellerPublicKey: input.sellerPublicKey,
      sellerName: input.sellerName,
      sellerEmail: input.sellerEmail,
      amount: input.amount,
      assetCode: (input.assetCode || 'XLM').toUpperCase(),
      assetIssuer: input.assetIssuer,
      memo,
      description: input.description,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      expiresAt,
    });

    console.log('✅ Invoice created:', invoice.id);
    return invoice;
  }

  /**
   * Draw a memo no live invoice holds. Throws rather than returning a memo that
   * is already taken: two invoices sharing one memo cannot be told apart by the
   * payment monitor, so this is a refusal to create, not a warning.
   */
  private drawUnusedMemo(): string {
    let candidate = this.nextMemo();

    for (
      let attempt = 1;
      attempt < MEMO_DRAW_ATTEMPTS && this.storage.hasMemo(candidate);
      attempt++
    ) {
      candidate = this.nextMemo();
    }

    if (this.storage.hasMemo(candidate)) {
      throw new MemoCollisionError(candidate);
    }

    return candidate;
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
    const existing = this.storage.getInvoiceById(invoiceId);
    if (!existing) {
      throw new Error('Invoice not found, expired, or already processed');
    }
    if (existing.status === 'PAID') {
      throw new IllegalStateTransitionError('PAID', 'PAID');
    }
    const now = Date.now();
    if (
      existing.status === 'EXPIRED' ||
      (existing.status === 'PENDING' && new Date(existing.expiresAt).getTime() <= now)
    ) {
      throw new IllegalStateTransitionError('EXPIRED', 'PAID');
    }
    if (existing.status === 'CANCELLED' && !options?.settledAt) {
      throw new SettlementTimeUnavailableError();
    }
    if (existing.status !== 'PENDING' && existing.status !== 'CANCELLED') {
      throw new IllegalStateTransitionError(existing.status as any, 'PAID');
    }

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
    const existing = this.storage.getInvoiceById(invoiceId);
    if (!existing) {
      throw new Error('Invoice not found');
    }
    if (sellerPublicKey && existing.sellerPublicKey !== sellerPublicKey) {
      const error = new Error('Unauthorized: only the seller can cancel this invoice');
      (error as any).status = 403;
      throw error;
    }
    if (existing.status !== 'PENDING') {
      throw new IllegalStateTransitionError(existing.status as any, 'CANCELLED');
    }
    const updated = this.storage.cancelInvoice(invoiceId, sellerPublicKey);
    if (!updated) {
      throw new Error('Invoice not found or already processed');
    }
    return updated;
  }

  async logPaymentEvent(invoiceId: string, eventType: string, eventData: any): Promise<void> {
    this.storage.logPaymentEvent(invoiceId, eventType, eventData);
  }

  async getPaymentEvents(invoiceId?: string): Promise<MemoryPaymentEvent[]> {
    return this.storage.getPaymentEvents(invoiceId);
  }

  async markExpiredInvoices(now?: Date): Promise<number> {
    return this.storage.markExpiredInvoices(now);
  }

  async getInvoiceStats(sellerPublicKey: string): Promise<InvoiceStats[]> {
    return [this.storage.getStats(sellerPublicKey)];
  }

  async countInvoices(): Promise<number> {
    return this.storage.countInvoices();
  }
}

export default new InvoiceMemoryService();
