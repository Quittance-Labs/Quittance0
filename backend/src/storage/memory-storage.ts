import { v4 as uuidv4 } from 'uuid';
import { calculateInvoiceStats } from './invoice-stats';
import type { InvoiceStats } from './invoice-stats';
import { isPendingInvoiceExpired } from '../domain/invoice-expiry';
import {
  settlementFieldsForInvoice,
  assertLegalStatusTransition,
} from '../domain/invoice-settlement';
import {
  InvoiceIdCollisionError,
  MemoCollisionError,
  PaymentClaimError,
  PaymentClaimIndex,
} from '../domain/payment-attribution';
import type { PaymentClaim } from '../domain/payment-attribution';
import type { MarkAsPaidOptions, StoredInvoice } from './invoice-storage';

export interface MemoryPaymentEvent {
  id: string;
  invoiceId: string;
  eventType: string;
  eventData: any;
  createdAt: Date;
}

type Invoice = StoredInvoice;

class MemoryStorage {
  private invoices: Map<string, Invoice> = new Map();
  private invoicesByMemo: Map<string, string> = new Map(); // memo -> invoice id
  // "sellerPublicKey|idempotencyKey" -> invoice id; replays a create instead of minting twice (issue #514).
  private invoicesByIdempotencyKey: Map<string, string> = new Map();
  // Which invoice each transaction hash settled; see domain/payment-attribution.ts.
  private readonly paymentClaims = new PaymentClaimIndex();
  private paymentEvents: MemoryPaymentEvent[] = [];

  createInvoice(data: Partial<Invoice>): Invoice {
    const invoice: Invoice = {
      id: data.id || uuidv4(),
      sellerPublicKey: data.sellerPublicKey!,
      sellerName: data.sellerName,
      sellerEmail: data.sellerEmail,
      amount: data.amount!,
      assetCode: (data.assetCode || 'XLM').toUpperCase(),
      assetIssuer: data.assetIssuer,
      memo: data.memo!,
      description: data.description,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: data.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      metadata: data.metadata,
      idempotencyKey: data.idempotencyKey,
    };

    // The memo index is keyed by memo, so a second invoice carrying the same
    // memo would overwrite the first one's entry and leave it unreachable by
    // the payment monitor. Refuse instead, and let creation draw another memo.
    if (this.invoicesByMemo.has(invoice.memo)) {
      throw new MemoCollisionError(invoice.memo);
    }

    // The id is the pay link (issue #512): a second invoice carrying an
    // existing id would overwrite the first invoice's destination. Refuse,
    // exactly like a memo collision.
    if (this.invoices.has(invoice.id)) {
      throw new InvoiceIdCollisionError(invoice.id);
    }

    this.invoices.set(invoice.id, invoice);
    this.invoicesByMemo.set(invoice.memo, invoice.id);
    if (invoice.idempotencyKey) {
      this.invoicesByIdempotencyKey.set(
        `${invoice.sellerPublicKey}|${invoice.idempotencyKey}`,
        invoice.id
      );
    }

    console.log('✅ Invoice created in memory:', invoice.id);
    return invoice;
  }

  /**
   * The invoice a previous create with this idempotency key produced, if any.
   * Lets the service replay the original record instead of minting a second
   * pay link for the same request (issue #514).
   */
  findByIdempotencyKey(sellerPublicKey: string, idempotencyKey: string): Invoice | undefined {
    const id = this.invoicesByIdempotencyKey.get(`${sellerPublicKey}|${idempotencyKey}`);
    return id ? this.invoices.get(id) : undefined;
  }

  // Get invoice by ID
  getInvoiceById(id: string): Invoice | undefined {
    this.markExpiredInvoices();
    return this.invoices.get(id);
  }

  // Get invoice by memo
  getInvoiceByMemo(memo: string): Invoice | undefined {
    this.markExpiredInvoices();
    const id = this.invoicesByMemo.get(memo);
    return id ? this.invoices.get(id) : undefined;
  }

  /** Read-only memo lookup, without the expiry sweep getInvoiceByMemo runs. */
  hasMemo(memo: string): boolean {
    return this.invoicesByMemo.has(memo);
  }

  /** Read-only claim lookup, for diagnostics and tests. */
  getPaymentClaim(txHash: string): PaymentClaim | undefined {
    return this.paymentClaims.peek(txHash);
  }

  // Update invoice
  updateInvoice(id: string, updates: Partial<Invoice>): Invoice | undefined {
    const invoice = this.invoices.get(id);
    if (!invoice) return undefined;

    const updated = { ...invoice, ...updates };
    this.invoices.set(id, updated);

    console.log('✅ Invoice updated:', id);
    return updated;
  }

  // Cancel invoice
  cancelInvoice(id: string, sellerPublicKey?: string): Invoice | undefined {
    this.markExpiredInvoices();
    const invoice = this.invoices.get(id);
    if (!invoice || invoice.status !== 'PENDING') return undefined;
    if (sellerPublicKey && invoice.sellerPublicKey !== sellerPublicKey) {
      throw new Error('Unauthorized: only the seller can cancel this invoice');
    }
    return this.updateInvoice(id, { status: 'CANCELLED', cancelledAt: new Date() });
  }

  // Mark as paid
  markAsPaid(
    id: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: { payerName?: string; payerEmail?: string },
    options: MarkAsPaidOptions = {}
  ): Invoice | undefined {
    this.markExpiredInvoices();
    const now = new Date();
    const invoice = this.invoices.get(id);
    if (!invoice) {
      return undefined;
    }
    if (invoice.status === 'CANCELLED') {
      assertLegalStatusTransition(invoice.status, 'PAID');
    }
    if (invoice.status !== 'PENDING' && invoice.status !== 'EXPIRED') {
      return undefined;
    }

    const settlement = settlementFieldsForInvoice(invoice, options.settledAt);

    // One transaction settles one invoice. The claim below reads and records in
    // the same synchronous step, so a second caller holding the same hash gets a
    // decision here rather than a second PAID transition. A replay against this
    // same invoice falls back to the "already processed" contract above.
    const decision = this.paymentClaims.claim(txHash, id, now);
    if (decision.kind === 'conflict') {
      throw new PaymentClaimError(txHash, id, decision.claim.invoiceId);
    }
    if (decision.kind === 'replay') return undefined;

    const updated = this.updateInvoice(id, {
      status: 'PAID',
      paymentTxHash: txHash,
      payerPublicKey,
      payerName: payerInfo?.payerName,
      payerEmail: payerInfo?.payerEmail,
      paidAt: now,
      cancelledAt: invoice.cancelledAt,
      settledAt: settlement.settledAt,
      settlementContext: settlement.settlementContext,
      priorStatus: settlement.priorStatus,
      latePaymentWarningCode: settlement.latePaymentWarningCode,
    });

    if (updated) {
      this.logPaymentEvent(id, 'PAYMENT_CONFIRMED', {
        txHash,
        payerPublicKey,
        settledAt: settlement.settledAt.toISOString(),
        settlementContext: settlement.settlementContext,
        priorStatus: settlement.priorStatus,
        latePaymentWarningCode: settlement.latePaymentWarningCode,
        ...(options.destinationMuxedId ? { destinationMuxedId: options.destinationMuxedId } : {}),
      });
    }

    return updated;
  }

  // Get all invoices
  getAllInvoices(filter?: { status?: string }): Invoice[] {
    this.markExpiredInvoices();
    let invoices = Array.from(this.invoices.values());

    if (filter?.status) {
      invoices = invoices.filter(inv => inv.status === filter.status);
    }

    return invoices.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // Get stats
  getStats(sellerPublicKey: string): InvoiceStats {
    this.markExpiredInvoices();
    return calculateInvoiceStats(Array.from(this.invoices.values()), sellerPublicKey);
  }

  // Mark expired invoices
  markExpiredInvoices(now: Date = new Date()): number {
    let count = 0;

    this.invoices.forEach((invoice) => {
      if (isPendingInvoiceExpired(invoice, now)) {
        invoice.status = 'EXPIRED';
        count++;
      }
    });

    if (count > 0) {
      console.log(`⏰ Marked ${count} invoices as expired`);
    }

    return count;
  }

  /**
   * Records a payment lifecycle audit event in memory.
   */
  logPaymentEvent(invoiceId: string, eventType: string, eventData: any): void {
    this.paymentEvents.push({
      id: uuidv4(),
      invoiceId,
      eventType,
      eventData,
      createdAt: new Date(),
    });
  }

  /**
   * Retrieves payment audit events, optionally filtered by invoice ID.
   */
  getPaymentEvents(invoiceId?: string): MemoryPaymentEvent[] {
    if (invoiceId) {
      return this.paymentEvents.filter((event) => event.invoiceId === invoiceId);
    }
    return [...this.paymentEvents];
  }

  // Clear all data (for testing)
  clear() {
    this.invoices.clear();
    this.invoicesByMemo.clear();
    this.invoicesByIdempotencyKey.clear();
    this.paymentClaims.clear();
    this.paymentEvents = [];
    console.log('🗑️ Memory storage cleared');
  }

  // Get size
  size(): number {
    return this.invoices.size;
  }

  countInvoices(): number {
    return this.invoices.size;
  }
}

export { MemoryStorage };
export default new MemoryStorage();
