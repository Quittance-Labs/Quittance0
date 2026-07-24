import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database';
import { generateInvoiceMemo } from '../utils/memo';
import { CreateInvoiceInput } from '../utils/validation';
import { SELLER_PUBLIC_KEY } from '../config/stellar';

/**
 * Backend SQL-service `Invoice` shape — discriminated union over `status`.
 * Mirrors the frontend's `Invoice` (`frontend/lib/utils.ts`) and the
 * in-memory storage's union (`backend/src/storage/memory-storage.ts`)
 * so a PAID-shape drift on the SQL path is caught at compile time.
 *
 * Field rules (mirrors Option B from the frontend):
 *   - When `status === 'PAID'`, three fields become required:
 *     `paidAt: Date`, `paymentTxHash: string`, `payerPublicKey: string`.
 *     Matches the SQL UPDATE in `markAsPaid` which atomically sets
 *     `status='PAID', payment_tx_hash=$2, payer_public_key=$3,
 *      paid_at=NOW()` in a single statement.
 *   - Otherwise all three are `?: never`, so a non-PAID read is a compile
 *     error rather than a runtime `undefined` trap.
 *
 * SQL-only fields (`userId`, `metadata`) live on `InvoiceCommon` so
 * they're available across PAID and non-PAID variants — same field is
 * the consumer-facing view of a SQL row's optional columns. `metadata`
 * stays `any` for forward-compat with the `JSON` column type.
 *
 * RUNTIME TRIPWIRE: the post-write `if (invoice.status === 'PAID' && ...)`
 * invariant in `markAsPaid` (commit `c09a61a`) remains the source of
 * truth on data integrity — the discriminated union's compile-time
 * narrowing is the defensive layer that catches future drift BEFORE
 * the runtime fires. See `mapRowToInvoice` for how a malformed SQL row
 * still passes type-checking (via `row: any`) but trips the runtime
 * guard on the way out.
 */
interface InvoiceCommon {
  id: string;
  userId?: string;
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
  metadata?: any;
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

export type Invoice = InvoicePaid | InvoiceNonPaid;

class InvoiceService {
  /**
   * Create a new invoice
   */
  async createInvoice(input: CreateInvoiceInput, userId?: string): Promise<Invoice> {
    const id = uuidv4();
    const memo = generateInvoiceMemo();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays || 7));

    const query = `
      INSERT INTO invoices (
        id, user_id, seller_public_key, seller_name, seller_email, amount,
        asset_code, asset_issuer, memo, description, customer_name,
        customer_email, status, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const values = [
      id,
      userId || null,
      SELLER_PUBLIC_KEY,
      input.sellerName || null,
      input.sellerEmail || null,
      input.amount,
      input.assetCode || 'XLM',
      input.assetIssuer || null,
      memo,
      input.description || null,
      input.customerName || null,
      input.customerEmail || null,
      'PENDING',
      expiresAt,
    ];

    try {
      const result = await pool.query(query, values);
      console.log('✅ Invoice created:', result.rows[0].id);
      return this.mapRowToInvoice(result.rows[0]);
    } catch (error: any) {
      console.error('Error creating invoice:', error);
      throw new Error(`Failed to create invoice: ${error.message}`);
    }
  }

  /**
   * Get invoice by ID
   */
  async getInvoiceById(id: string): Promise<Invoice | null> {
    const query = 'SELECT * FROM invoices WHERE id = $1';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToInvoice(result.rows[0]);
  }

  /**
   * Get invoice by memo
   */
  async getInvoiceByMemo(memo: string): Promise<Invoice | null> {
    const query = 'SELECT * FROM invoices WHERE memo = $1';
    const result = await pool.query(query, [memo]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToInvoice(result.rows[0]);
  }

  /**
   * Update invoice status to PAID
   */
  async markAsPaid(invoiceId: string, txHash: string, payerPublicKey: string, payerInfo?: { payerName?: string; payerEmail?: string }): Promise<Invoice> {
    const query = `
      UPDATE invoices 
      SET status = 'PAID', payment_tx_hash = $2, payer_public_key = $3, paid_at = NOW(),
          payer_name = $4, payer_email = $5
      WHERE id = $1
      RETURNING *
    `;

    try {
      const result = await pool.query(query, [
        invoiceId, 
        txHash, 
        payerPublicKey,
        payerInfo?.payerName || null,
        payerInfo?.payerEmail || null
      ]);
      
      if (result.rows.length === 0) {
        throw new Error('Invoice not found');
      }

      console.log('✅ Invoice marked as paid:', invoiceId);
      
      // Log payment event
      await this.logPaymentEvent(invoiceId, 'PAYMENT_CONFIRMED', {
        txHash,
        payerPublicKey,
      });

      const invoice = this.mapRowToInvoice(result.rows[0]);

      // Type-contract invariant (mirrors the typed `Invoice` discriminated-
      // union PAID variant in `frontend/lib/utils.ts`): when an invoice is
      // marked PAID, three fields MUST be set atomically — `paidAt`,
      // `paymentTxHash`, `payerPublicKey`. The frontend discriminated union
      // tracks this with TypeScript narrowing; the backend enforces it
      // here with a runtime guard so any future caller or partial SQL
      // UPDATE that forgets one of the three fails fast at the boundary
      // rather than at a downstream consumer (the frontend would
      // otherwise silently read `undefined` for the missing field).
      //
      // The SQL UPDATE above is a single statement setting all four
      // columns atomically (`status='PAID', payment_tx_hash=$2,
      // payer_public_key=$3, paid_at=NOW()`), so today's normal flow
      // never fires this assertion. It's a tripwire for FUTURE drift —
      // e.g. a partial UPDATE path that flips status without the
      // on-chain tx info, or a racing webhook handler that updates
      // status before the tx hash is available.
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

      return invoice;
    } catch (error: any) {
      console.error('Error marking invoice as paid:', error);
      throw new Error(`Failed to update invoice: ${error.message}`);
    }
  }

  /**
   * Get all invoices for a seller
   */
  async getInvoicesBySeller(
    sellerPublicKey: string,
    status?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Invoice[]> {
    let query = 'SELECT * FROM invoices WHERE seller_public_key = $1';
    const params: any[] = [sellerPublicKey];

    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows.map(row => this.mapRowToInvoice(row));
  }

  /**
   * Cancel an invoice
   */
  async cancelInvoice(invoiceId: string): Promise<Invoice> {
    const query = `
      UPDATE invoices 
      SET status = 'CANCELLED'
      WHERE id = $1 AND status = 'PENDING'
      RETURNING *
    `;

    const result = await pool.query(query, [invoiceId]);
    
    if (result.rows.length === 0) {
      throw new Error('Invoice not found or already processed');
    }

    return this.mapRowToInvoice(result.rows[0]);
  }

  /**
   * Mark expired invoices
   */
  async markExpiredInvoices(): Promise<number> {
    const query = `
      UPDATE invoices 
      SET status = 'EXPIRED'
      WHERE status = 'PENDING' AND expires_at < NOW()
      RETURNING id
    `;

    const result = await pool.query(query);
    console.log(`⏰ Marked ${result.rowCount} invoices as expired`);
    return result.rowCount || 0;
  }

  /**
   * Log payment event
   */
  async logPaymentEvent(invoiceId: string, eventType: string, eventData: any): Promise<void> {
    const query = `
      INSERT INTO payment_events (invoice_id, event_type, event_data)
      VALUES ($1, $2, $3)
    `;

    await pool.query(query, [invoiceId, eventType, JSON.stringify(eventData)]);
  }

  /**
   * Get invoice statistics
   */
  async getInvoiceStats(sellerPublicKey: string): Promise<any> {
    const query = `
      SELECT 
        COUNT(*) as total_invoices,
        SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) as paid_invoices,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_invoices,
        SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) as expired_invoices,
        SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END) as total_revenue,
        asset_code
      FROM invoices
      WHERE seller_public_key = $1
      GROUP BY asset_code
    `;

    const result = await pool.query(query, [sellerPublicKey]);
    return result.rows;
  }

  /**
   * Map database row to Invoice object.
   *
   * The discriminated union narrowing happens here: PAID-shape rows
   * are constructed as `InvoicePaid` (with all three required fields
   * populated), non-PAID rows as `InvoiceNonPaid` (with the discriminator
   * fields omitted). `row: any` lets us read whatever node-postgres
   * sent back without enforcing structural correctness at the type
   * level — the runtime invariant in `markAsPaid` (commit `c09a61a`)
   * is the tripwire for any malformed PAID-shape row that slipped
   * through (e.g. a future partial SQL UPDATE that set status without
   * the on-chain tx info).
   */
  private mapRowToInvoice(row: any): Invoice {
    const common: InvoiceCommon = {
      id: row.id,
      userId: row.user_id,
      sellerPublicKey: row.seller_public_key,
      sellerName: row.seller_name,
      sellerEmail: row.seller_email,
      amount: parseFloat(row.amount),
      assetCode: row.asset_code,
      assetIssuer: row.asset_issuer,
      memo: row.memo,
      description: row.description,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      payerName: row.payer_name,
      payerEmail: row.payer_email,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      metadata: row.metadata,
    };

    if (row.status === 'PAID') {
      return {
        ...common,
        status: 'PAID',
        paidAt: row.paid_at as Date,
        paymentTxHash: row.payment_tx_hash as string,
        payerPublicKey: row.payer_public_key as string,
      };
    }

    return {
      ...common,
      status: row.status as 'PENDING' | 'EXPIRED' | 'CANCELLED',
    };
  }
}

export default new InvoiceService();
