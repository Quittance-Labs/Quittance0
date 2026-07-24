// Invoice service with in-memory storage
import { generateInvoiceMemo } from '../utils/memo';
import { CreateInvoiceInput } from '../utils/validation';
import memoryStorage from '../storage/memory-storage';

class InvoiceMemoryService {
  /**
   * Create a new invoice
   */
  async createInvoice(input: CreateInvoiceInput): Promise<any> {
    // Seller public key artık frontend'den geliyor!
    if (!input.sellerPublicKey) {
      throw new Error('Seller public key is required');
    }

    const memo = generateInvoiceMemo();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays || 7));

    const invoice = memoryStorage.createInvoice({
      sellerPublicKey: input.sellerPublicKey, // Dinamik!
      sellerName: input.sellerName,
      sellerEmail: input.sellerEmail,
      amount: input.amount,
      assetCode: input.assetCode || 'XLM',
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
   * Get invoice by ID
   */
  async getInvoiceById(id: string): Promise<any | null> {
    return memoryStorage.getInvoiceById(id);
  }

  /**
   * Get invoice by memo
   */
  async getInvoiceByMemo(memo: string): Promise<any | null> {
    return memoryStorage.getInvoiceByMemo(memo);
  }

  /**
   * Update invoice status to PAID
   */
  async markAsPaid(
    invoiceId: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: { payerName?: string; payerEmail?: string }
  ): Promise<any> {
    const invoice = memoryStorage.markAsPaid(invoiceId, txHash, payerPublicKey, payerInfo);

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // Type-contract invariant (mirrors the typed `Invoice` discriminated-
    // union PAID variant in `frontend/lib/utils.ts`): when an invoice is
    // marked PAID, three fields MUST be set atomically — `paidAt`,
    // `paymentTxHash`, `payerPublicKey`. The frontend discriminated union
    // tracks this with TypeScript narrowing; the backend enforces it
    // here with a runtime guard so any future caller or SQL-UPDATE path
    // that forgets one of the three fails fast at the boundary rather
    // than at a downstream consumer (the frontend would otherwise
    // silently read `undefined` for the missing field).
    //
    // Today's `memoryStorage.markAsPaid` correctly sets all three in a
    // single `updateInvoice({…})` call, so this assertion never fires in
    // normal flow. It's a tripwire for FUTURE drift — e.g. a partial
    // SQL update path that sets status='PAID' without the on-chain tx
    // info, or a webhook handler that updates status before the tx hash
    // is available.
    if (
      invoice.status === 'PAID' &&
      (!invoice.paidAt || !invoice.paymentTxHash || !invoice.payerPublicKey)
    ) {
      throw new Error(
        `Invariant violation: invoice ${invoice.id} has status='PAID' but ` +
        `one of paidAt, paymentTxHash, payerPublicKey is unset. ` +
        `markAsPaid must atomically persist all three of {paidAt, paymentTxHash, payerPublicKey}.`
      );
    }

    console.log('✅ Invoice marked as paid:', invoiceId);
    return invoice;
  }

  /**
   * Get all invoices for a seller
   */
  async getInvoicesBySeller(
    sellerPublicKey: string,
    status?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any[]> {
    let invoices = memoryStorage.getAllInvoices(status ? { status } : undefined);

    if (sellerPublicKey) {
      invoices = invoices.filter((inv) => inv.sellerPublicKey === sellerPublicKey);
    }

    return invoices.slice(offset, offset + limit);
  }

  /**
   * Cancel an invoice
   */
  async cancelInvoice(invoiceId: string): Promise<any> {
    const invoice = memoryStorage.getInvoiceById(invoiceId);

    if (!invoice || invoice.status !== 'PENDING') {
      throw new Error('Invoice not found or already processed');
    }

    return memoryStorage.updateInvoice(invoiceId, { status: 'CANCELLED' });
  }

  /**
   * Mark expired invoices
   */
  async markExpiredInvoices(): Promise<number> {
    return memoryStorage.markExpiredInvoices();
  }

  /**
   * Get invoice statistics
   */
  async getInvoiceStats(sellerPublicKey: string): Promise<any> {
    return [memoryStorage.getStats(sellerPublicKey)];
  }
}

export default new InvoiceMemoryService();
