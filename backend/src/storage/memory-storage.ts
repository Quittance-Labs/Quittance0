import { v4 as uuidv4 } from 'uuid';
import { calculateInvoiceStats } from './invoice-stats';
import type { InvoiceStats } from './invoice-stats';
import { isPendingInvoiceExpired } from '../domain/invoice-expiry';
import {
  MemoCollisionError,
  PaymentClaimError,
  PaymentClaimIndex,
} from '../domain/payment-attribution';
import type { PaymentClaim } from '../domain/payment-attribution';
import type { StoredInvoice } from './invoice-storage';

type Invoice = StoredInvoice;

class MemoryStorage {
  private invoices: Map<string, Invoice> = new Map();
  private invoicesByMemo: Map<string, string> = new Map(); // memo -> invoice id
  // Which invoice each transaction hash settled; see domain/payment-attribution.ts.
  private readonly paymentClaims = new PaymentClaimIndex();

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
    };

    // The memo index is keyed by memo, so a second invoice carrying the same
    // memo would overwrite the first one's entry and leave it unreachable by
    // the payment monitor. Refuse instead, and let creation draw another memo.
    if (this.invoicesByMemo.has(invoice.memo)) {
      throw new MemoCollisionError(invoice.memo);
    }

    this.invoices.set(invoice.id, invoice);
    this.invoicesByMemo.set(invoice.memo, invoice.id);

    console.log('✅ Invoice created in memory:', invoice.id);
    return invoice;
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
    return this.updateInvoice(id, { status: 'CANCELLED' });
  }

  // Mark as paid
  markAsPaid(
    id: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: { payerName?: string; payerEmail?: string }
  ): Invoice | undefined {
    this.markExpiredInvoices();
    const now = new Date();
    const invoice = this.invoices.get(id);
    if (!invoice || invoice.status !== 'PENDING') return undefined;
    if (new Date(invoice.expiresAt).getTime() <= now.getTime()) return undefined;

    // One transaction settles one invoice. The claim below reads and records in
    // the same synchronous step, so a second caller holding the same hash gets a
    // decision here rather than a second PAID transition. A replay against this
    // same invoice falls back to the "already processed" contract above.
    const decision = this.paymentClaims.claim(txHash, id, now);
    if (decision.kind === 'conflict') {
      throw new PaymentClaimError(txHash, id, decision.claim.invoiceId);
    }
    if (decision.kind === 'replay') return undefined;

    return this.updateInvoice(id, {
      status: 'PAID',
      paymentTxHash: txHash,
      payerPublicKey,
      payerName: payerInfo?.payerName,
      payerEmail: payerInfo?.payerEmail,
      paidAt: new Date(),
    });
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

  // Clear all data (for testing)
  clear() {
    this.invoices.clear();
    this.invoicesByMemo.clear();
    this.paymentClaims.clear();
    console.log('🗑️ Memory storage cleared');
  }

  // Get size
  size(): number {
    return this.invoices.size;
  }
}

export { MemoryStorage };
export default new MemoryStorage();
