import { InvoiceIdCollisionError, MemoCollisionError } from '../domain/payment-attribution';
import { generateInvoiceMemo } from '../utils/memo';
import { generatePublicInvoiceId } from '../utils/memory-public-id';
import { CreateInvoiceInput } from '../utils/validation';
import memoryStorage, { MemoryStorage, MemoryPaymentEvent } from '../storage/memory-storage';
import { calculateInvoiceExpiry } from '../domain/invoice-expiry';
import type { StoredInvoice } from '../storage/invoice-storage';
import type { InvoiceStats } from '../storage/invoice-stats';
import type { MarkAsPaidOptions, PayerInfo } from '../storage/invoice-storage';

/**
 * How many times invoice creation re-draws a memo before giving up.
 *
 * A collision means another live invoice already holds that memo, which is how
 * one on-chain payment could otherwise be made to satisfy two invoices. Against
 * a per-millisecond random suffix a second draw is already generous; the point
 * of the bound is to fail loudly instead of looping.
 */
const DRAW_ATTEMPTS = 3;

export class InvoiceMemoryService {
  constructor(
    private readonly storage: MemoryStorage = memoryStorage,
    /** Injectable so the collision path is testable without waiting for one. */
    private readonly nextMemo: () => string = generateInvoiceMemo,
    /** Injectable so the id-collision path is testable without waiting for one. */
    private readonly nextId: () => string = generatePublicInvoiceId
  ) {}

  async createInvoice(input: CreateInvoiceInput): Promise<StoredInvoice> {
    if (!input.sellerPublicKey) {
      throw new Error('Seller public key is required');
    }

    // Issue #514: a replayed create (same Idempotency-Key, or the derived
    // signature inside its window) returns the original invoice instead of
    // minting a second memo and pay link.
    if (input.idempotencyKey) {
      const existing = this.storage.findByIdempotencyKey(
        input.sellerPublicKey,
        input.idempotencyKey
      );
      if (existing) {
        return existing;
      }
    }

    const id = this.drawUnusedId();
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
      idempotencyKey: input.idempotencyKey,
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
      attempt < DRAW_ATTEMPTS && this.storage.hasMemo(candidate);
      attempt++
    ) {
      candidate = this.nextMemo();
    }

    if (this.storage.hasMemo(candidate)) {
      throw new MemoCollisionError(candidate);
    }

    return candidate;
  }

  /**
   * Draw a public id no live invoice holds (issue #512). The id is the pay
   * link: a silent overwrite would hand a payer an existing invoice's
   * destination, so an exhausted draw refuses creation instead.
   */
  private drawUnusedId(): string {
    let candidate = this.nextId();

    for (
      let attempt = 1;
      attempt < DRAW_ATTEMPTS && this.storage.getInvoiceById(candidate);
      attempt++
    ) {
      candidate = this.nextId();
    }

    if (this.storage.getInvoiceById(candidate)) {
      throw new InvoiceIdCollisionError(candidate);
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
    offset: number = 0,
    q?: string
  ): Promise<StoredInvoice[]> {
    let invoices = this.storage.getAllInvoices(status ? { status } : undefined);

    if (sellerPublicKey) {
      invoices = invoices.filter((inv) => inv.sellerPublicKey === sellerPublicKey);
    }

    // Server-side search stays inside the seller scope (issue #444): memo,
    // public id, and client name are the primary fields; description is
    // included because sellers type it themselves.
    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      invoices = invoices.filter((inv) => {
        const text = [
          inv.id,
          inv.memo,
          inv.description,
          inv.customerName,
          inv.customerEmail,
        ]
          .filter((value) => value !== undefined && value !== null && value !== '')
          .join(' ')
          .toLowerCase();
        return text.includes(term);
      });
    }

    return invoices.slice(offset, offset + limit);
  }

  /**
   * PENDING invoices due for monitor re-watch after a restart (issue #502).
   * Seller-scoped when a key is given; otherwise all pending in MVP memory.
   */
  async listPendingInvoices(
    sellerPublicKey?: string,
    limit: number = 500
  ): Promise<StoredInvoice[]> {
    await this.markExpiredInvoices();
    let invoices = this.storage.getAllInvoices({ status: 'PENDING' });
    if (sellerPublicKey) {
      invoices = invoices.filter((inv) => inv.sellerPublicKey === sellerPublicKey);
    }
    return invoices.slice(0, Math.max(1, limit));
  }

  async cancelInvoice(invoiceId: string, sellerPublicKey?: string): Promise<StoredInvoice> {
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
