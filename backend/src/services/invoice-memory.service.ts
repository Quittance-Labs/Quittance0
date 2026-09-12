import { MemoCollisionError } from '../domain/payment-attribution';
import { generateInvoiceMemo } from '../utils/memo';
import { generatePublicInvoiceId } from '../utils/memory-public-id';
import { CreateInvoiceInput } from '../utils/validation';
import memoryStorage, { MemoryStorage } from '../storage/memory-storage';
import { calculateInvoiceExpiry } from '../domain/invoice-expiry';
import type { StoredInvoice } from '../storage/invoice-storage';
import type { InvoiceStats } from '../storage/invoice-stats';
import type { PayerInfo } from '../storage/invoice-storage';

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
    payerInfo?: PayerInfo
  ): Promise<StoredInvoice> {
    const invoice = this.storage.markAsPaid(invoiceId, txHash, payerPublicKey, payerInfo);

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

    const updated = this.storage.updateInvoice(invoiceId, { status: 'CANCELLED' });
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
}

export default new InvoiceMemoryService();
