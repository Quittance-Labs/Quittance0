// In-memory storage - Database yerine MVP için
import { v4 as uuidv4 } from 'uuid';

/**
 * Backend `Invoice` shape — discriminated union over `status`. Mirrors
 * the frontend's `Invoice` discriminated union (`frontend/lib/utils.ts`)
 * so a PAID-shape drift on the backend is caught at compile time
 * (TypeScript narrowing) AND at runtime (the `markAsPaid` invariant
 * from commit `8b38f7c`).
 *
 * Field rules (mirrors Option B from the frontend):
 *   - When `status === 'PAID'`, three fields become required:
 *     `paidAt: Date`, `paymentTxHash: string`, `payerPublicKey: string`.
 *     Matches `memoryStorage.markAsPaid` and `invoiceMemoryService.markAsPaid`'s
 *     atomic-three-fields contract: status flips to PAID together with
 *     `paidAt = new Date()`, `paymentTxHash = txHash`, and
 *     `payerPublicKey = payerPublicKey` in a single `updateInvoice({…})` call.
 *   - Otherwise all three are `?: never`, so a non-PAID read is a compile
 *     error rather than a runtime `undefined` trap.
 *
 * `InvoiceCommon` deliberately does NOT include `paidAt/paymentTxHash/
 * payerPublicKey` — adding any of those to the base interface would
 * silently opt every variant into "these may exist", defeating the
 * discrimination. Same structural convention as the frontend.
 *
 * TypeScript narrows on a `status === 'PAID'` discriminator:
 * ```
 * if (invoice.status === 'PAID') {
 *   invoice.paidAt;            // Date
 *   invoice.paymentTxHash;     // string
 *   invoice.payerPublicKey;    // string
 * }
 * ```
 *
 * RUNTIME TRIPWIRE: `invoiceMemoryService.markAsPaid` still runs
 * `if (invoice.status === 'PAID' && (!invoice.paidAt || !invoice.paymentTxHash || !invoice.payerPublicKey))`
 * after `markAsPaid` returns. The runtime guard remains the source of
 * truth on data integrity — the discriminated union's compile-time
 * narrowing is the defensive layer that catches future drift BEFORE
 * the runtime fires.
 */
interface InvoiceCommon {
  id: string;
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
  payerName?: string;
  payerEmail?: string;
  createdAt: Date;
  expiresAt: Date;
}

type InvoicePaid = InvoiceCommon & {
  status: 'PAID';
  paidAt: Date;
  paymentTxHash: string;
  payerPublicKey: string;
};

type InvoiceNonPaid = InvoiceCommon & {
  status: 'PENDING' | 'EXPIRED' | 'CANCELLED';
  paidAt?: never;
  paymentTxHash?: never;
  payerPublicKey?: never;
};

type Invoice = InvoicePaid | InvoiceNonPaid;

class MemoryStorage {
  private invoices: Map<string, Invoice> = new Map();
  private invoicesByMemo: Map<string, string> = new Map(); // memo -> invoice id

  // Create invoice
  createInvoice(data: Partial<Invoice>): Invoice {
    const invoice: Invoice = {
      id: data.id || uuidv4(),
      sellerPublicKey: data.sellerPublicKey!,
      sellerName: data.sellerName,
      sellerEmail: data.sellerEmail,
      amount: data.amount!,
      assetCode: data.assetCode || 'XLM',
      assetIssuer: data.assetIssuer,
      memo: data.memo!,
      description: data.description,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt: data.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };

    this.invoices.set(invoice.id, invoice);
    this.invoicesByMemo.set(invoice.memo, invoice.id);

    console.log('✅ Invoice created in memory:', invoice.id);
    return invoice;
  }

  // Get invoice by ID
  getInvoiceById(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }

  // Get invoice by memo
  getInvoiceByMemo(memo: string): Invoice | undefined {
    const id = this.invoicesByMemo.get(memo);
    return id ? this.invoices.get(id) : undefined;
  }

  // Update invoice
  updateInvoice(id: string, updates: Partial<Invoice>): Invoice | undefined {
    const invoice = this.invoices.get(id);
    if (!invoice) return undefined;

    // The discriminated-union narrowing through `{ ...invoice, ...updates }`
    // doesn't compile cleanly: TypeScript can't prove the spread result
    // fits one of `InvoicePaid | InvoiceNonPaid` exhaustively, because the
    // merge could in principle produce a structurally-invalid shape (e.g.
    // `status: 'PAID'` paired with an absent `paidAt`).
    //
    // The `as Invoice` cast preserves the discriminated contract at the
    // assignment boundary. Same escape-hatch pattern as
    // `invoice.service.ts:mapRowToInvoice`, which uses `as Date` /
    // `as string` casts at the SQL-row->Invoice construction site for
    // exactly the same reason (`row: any` cannot enforce the union
    // structurally).
    //
    // RUNTIME SAFETY: the cast does NOT validate runtime values. The
    // invariant in `invoiceMemoryService.markAsPaid` (commit `8b38f7c`)
    // is the tripwire — if a future caller writes `markAsPaid` with a
    // partial PAID-shape payload that somehow slips past a refactor and
    // lands in the storage as `{status:'PAID', paymentTxHash:undefined}`,
    // post-`updateInvoice` the invariant at the service layer still
    // catches the drift:
    //   `if (invoice.status === 'PAID' && (!invoice.paidAt || !invoice.paymentTxHash || !invoice.payerPublicKey))`
    //
    // CAST IS THE LAST COMPILE-TIME DEFENSE — the runtime invariant in
    // `invoiceMemoryService.markAsPaid` (commit `8b38f7c`) is the second
    // line of defense and still catches the same malformed PAID-shape
    // drift at runtime. The cast below trusts the union narrowing; the
    // invariant at the service layer enforces it. Both layers must hold.
    //
    // `markAsPaid`'s call site MUST always include `status: 'PAID'`
    // together with all three of `paymentTxHash`, `payerPublicKey`,
    // `paidAt` in a single object. If a future caller weakens that
    // contract (e.g. drops `status` from the call site), the cast below
    // silently preserves the prior status without complaint — the
    // discriminated union's narrowing is no longer enforced for that
    // path.
    const updated = { ...invoice, ...updates } as Invoice;
    this.invoices.set(id, updated);

    console.log('✅ Invoice updated:', id);
    return updated;
  }

  // Mark as paid
  markAsPaid(
    id: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: { payerName?: string; payerEmail?: string }
  ): Invoice | undefined {
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
    let invoices = Array.from(this.invoices.values());

    if (filter?.status) {
      invoices = invoices.filter(inv => inv.status === filter.status);
    }

    return invoices.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // Get stats
  getStats(sellerPublicKey: string): any {
    const invoices = Array.from(this.invoices.values()).filter(
      inv => inv.sellerPublicKey === sellerPublicKey
    );

    return {
      total_invoices: invoices.length,
      paid_invoices: invoices.filter(inv => inv.status === 'PAID').length,
      pending_invoices: invoices.filter(inv => inv.status === 'PENDING').length,
      expired_invoices: invoices.filter(inv => inv.status === 'EXPIRED').length,
      total_revenue: invoices
        .filter(inv => inv.status === 'PAID')
        .reduce((sum, inv) => sum + inv.amount, 0),
      asset_code: 'XLM',
    };
  }

  // Mark expired invoices
  markExpiredInvoices(): number {
    const now = new Date();
    let count = 0;

    this.invoices.forEach((invoice) => {
      if (invoice.status === 'PENDING' && invoice.expiresAt < now) {
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
    console.log('🗑️ Memory storage cleared');
  }

  // Get size
  size(): number {
    return this.invoices.size;
  }
}

export default new MemoryStorage();
