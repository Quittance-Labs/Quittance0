import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database';
import { generateInvoiceMemo } from '../utils/memo';
import { CreateInvoiceInput } from '../utils/validation';
import type { InvoiceStats } from '../storage/invoice-stats';
import { calculateInvoiceExpiry } from '../domain/invoice-expiry';
import { IllegalStateTransitionError } from '../domain/invoice-lifecycle';
import {
  SettlementTimeUnavailableError,
  type LatePaymentWarningCode,
  type SettlementContext,
} from '../domain/invoice-settlement';
import type { MarkAsPaidOptions } from '../storage/invoice-storage';

// PostgreSQL invoice service. Kept behaviourally identical to
// InvoiceMemoryService so callers that go through the shared InvoiceStorage
// interface cannot tell which backend is running. Invariants mirrored on both
// sides: (1) normal markAsPaid succeeds when status is PENDING AND expires_at
// is strictly after now(), while an exact cancelled-invoice payment may settle
// with cancellation context, (2) cancelInvoice only succeeds when status is
// PENDING, (3) every read path calls markExpiredInvoices first so expired rows
// transition before being reported, (4) list + stats are scoped to the caller's
// seller_public_key, (5) credit assets always carry their asset_issuer because
// createInvoiceSchema already rejected anything less.
/** Minimal database surface used by this service (pg Pool or a test double). */
export interface Queryable {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface Invoice {
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
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  paymentTxHash?: string;
  payerPublicKey?: string;
  payerName?: string;
  payerEmail?: string;
  createdAt: Date;
  paidAt?: Date;
  cancelledAt?: Date;
  settledAt?: Date;
  settlementContext?: SettlementContext;
  priorStatus?: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  latePaymentWarningCode?: LatePaymentWarningCode;
  expiresAt: Date;
  metadata?: any;
}

export class InvoiceService {
  constructor(private readonly db: Queryable = pool) {}

  /**
   * Create a new invoice for the seller wallet supplied by the request
   */
  async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
    if (!input.sellerPublicKey) {
      throw new Error('Seller public key is required');
    }

    const id = uuidv4();
    const memo = generateInvoiceMemo();
    const expiresAt = calculateInvoiceExpiry(input.expiresInDays);

    const query = `
      INSERT INTO invoices (
        id, seller_public_key, seller_name, seller_email, amount,
        asset_code, asset_issuer, memo, description, customer_name,
        customer_email, status, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;

    const values = [
      id,
      input.sellerPublicKey,
      input.sellerName || null,
      input.sellerEmail || null,
      input.amount,
      (input.assetCode || 'XLM').toUpperCase(),
      input.assetIssuer || null,
      memo,
      input.description || null,
      input.customerName || null,
      input.customerEmail || null,
      'PENDING',
      expiresAt,
    ];

    try {
      const result = await this.db.query(query, values);
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
    await this.markExpiredInvoices();
    const query = 'SELECT * FROM invoices WHERE id = $1';
    const result = await this.db.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToInvoice(result.rows[0]);
  }

  /**
   * Get invoice by memo
   */
  async getInvoiceByMemo(memo: string): Promise<Invoice | null> {
    await this.markExpiredInvoices();
    const query = 'SELECT * FROM invoices WHERE memo = $1';
    const result = await this.db.query(query, [memo]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToInvoice(result.rows[0]);
  }

  /**
   * Update invoice status to PAID
   */
  async markAsPaid(
    invoiceId: string,
    txHash: string,
    payerPublicKey: string,
    payerInfo?: { payerName?: string; payerEmail?: string },
    options?: MarkAsPaidOptions
  ): Promise<Invoice> {
    const settledAt = options?.settledAt ?? null;
    const query = `
      WITH settled AS (
        UPDATE invoices
        SET status = 'PAID',
            payment_tx_hash = $2,
            payer_public_key = $3,
            paid_at = NOW(),
            payer_name = $4,
            payer_email = $5,
            settled_at = COALESCE($6::timestamptz, NOW()),
            settlement_context = CASE
              WHEN status = 'CANCELLED' AND $6::timestamptz >= cancelled_at THEN 'AFTER_CANCEL'
              ELSE 'ON_TIME'
            END,
            prior_status = CASE
              WHEN status = 'CANCELLED' THEN status
              ELSE NULL
            END,
            late_payment_warning_code = CASE
              WHEN status = 'CANCELLED' AND $6::timestamptz >= cancelled_at THEN 'PAYMENT_RECEIVED_AFTER_CANCEL'
              ELSE NULL
            END
        WHERE id = $1
          AND (
            (status = 'PENDING' AND expires_at > NOW())
            OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND $6::timestamptz IS NOT NULL)
          )
        RETURNING *
      ),
      payment_event AS (
        INSERT INTO payment_events (invoice_id, event_type, event_data)
        SELECT
          id,
          'PAYMENT_CONFIRMED',
          jsonb_strip_nulls(jsonb_build_object(
            'txHash', $2::text,
            'payerPublicKey', $3::text,
            'settledAt', settled_at,
            'settlementContext', settlement_context,
            'priorStatus', prior_status,
            'latePaymentWarningCode', late_payment_warning_code
          ))
        FROM settled
        RETURNING id
      )
      SELECT * FROM settled
    `;

    try {
      const result = await this.db.query(query, [
        invoiceId,
        txHash,
        payerPublicKey,
        payerInfo?.payerName || null,
        payerInfo?.payerEmail || null,
        settledAt,
      ]);

      if (result.rows.length === 0) {
        const existing = await this.db.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
        if (existing.rows.length === 0) {
          throw new Error('Invoice not found');
        }
        const current = existing.rows[0];
        if (current.status === 'PAID') {
          throw new IllegalStateTransitionError('PAID', 'PAID');
        }
        if (
          current.status === 'EXPIRED' ||
          (current.status === 'PENDING' && new Date(current.expires_at).getTime() <= Date.now())
        ) {
          throw new IllegalStateTransitionError('EXPIRED', 'PAID');
        }
        if (current.status === 'CANCELLED' && !settledAt) {
          throw new SettlementTimeUnavailableError();
        }
        if (current.status !== 'PENDING' && current.status !== 'CANCELLED') {
          throw new IllegalStateTransitionError(current.status, 'PAID');
        }
        throw new Error('Invoice not found, expired, or already processed');
      }

      console.log('✅ Invoice marked as paid:', invoiceId);

      return this.mapRowToInvoice(result.rows[0]);
    } catch (error: any) {
      if (
        error instanceof SettlementTimeUnavailableError ||
        error instanceof IllegalStateTransitionError
      ) {
        throw error;
      }
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
    if (!sellerPublicKey) {
      throw new Error('Seller public key is required');
    }

    await this.markExpiredInvoices();

    let query = 'SELECT * FROM invoices WHERE seller_public_key = $1';
    const params: any[] = [sellerPublicKey];

    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await this.db.query(query, params);
    return result.rows.map((row) => this.mapRowToInvoice(row));
  }

  /**
   * Cancel an invoice
   */
  async cancelInvoice(invoiceId: string, sellerPublicKey?: string): Promise<Invoice> {
    await this.markExpiredInvoices();

    const query = `
      UPDATE invoices 
      SET status = 'CANCELLED', cancelled_at = NOW()
      WHERE id = $1 AND status = 'PENDING' AND ($2::text IS NULL OR seller_public_key = $2)
      RETURNING *
    `;

    const result = await this.db.query(query, [invoiceId, sellerPublicKey || null]);

    if (result.rows.length === 0) {
      const existing = await this.db.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
      if (existing.rows.length === 0) {
        throw new Error('Invoice not found');
      }
      const current = existing.rows[0];
      if (
        sellerPublicKey &&
        current.status === 'PENDING' &&
        current.seller_public_key !== sellerPublicKey
      ) {
        throw new Error('Unauthorized: only the seller can cancel this invoice');
      }
      if (current.status !== 'PENDING') {
        throw new IllegalStateTransitionError(current.status, 'CANCELLED');
      }
      throw new Error('Invoice not found or already processed');
    }

    return this.mapRowToInvoice(result.rows[0]);
  }

  /**
   * Mark expired invoices
   */
  async markExpiredInvoices(now: Date = new Date()): Promise<number> {
    const query = `
      UPDATE invoices 
      SET status = 'EXPIRED'
      WHERE status = 'PENDING' AND expires_at <= $1
      RETURNING id
    `;

    const result = await this.db.query(query, [now]);
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

    await this.db.query(query, [invoiceId, eventType, JSON.stringify(eventData)]);
  }

  /**
   * Get invoice statistics
   */
  async getInvoiceStats(sellerPublicKey: string): Promise<InvoiceStats[]> {
    if (!sellerPublicKey) {
      throw new Error('Seller public key is required');
    }

    await this.markExpiredInvoices();

    const query = `
      SELECT 
        COUNT(*) as total_invoices,
        COALESCE(SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END), 0) as paid_invoices,
        COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) as pending_invoices,
        COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) as actionable_invoices,
        COALESCE(SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END), 0) as expired_invoices,
        COALESCE(
          (
            SELECT jsonb_object_agg(asset_code, total_revenue)
            FROM (
              SELECT COALESCE(asset_code, 'XLM') as asset_code, SUM(amount) as total_revenue
              FROM invoices
              WHERE seller_public_key = $1 AND status = 'PAID'
              GROUP BY COALESCE(asset_code, 'XLM')
            ) paid_revenue
          ),
          '{}'::jsonb
        ) as revenue_by_asset
      FROM invoices
      WHERE seller_public_key = $1
    `;

    const result = await this.db.query(query, [sellerPublicKey]);
    return result.rows.map((row) => this.mapRowToStats(row));
  }

  /**
   * Get total invoice count (for ceiling enforcement)
   */
  async getInvoiceCount(): Promise<number> {
    const query = 'SELECT COUNT(*) as count FROM invoices';
    const result = await this.db.query(query);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Map an aggregate row to stats. Postgres returns COUNT/SUM as strings, so the
   * numbers are normalised to match the in-memory backend.
   */
  private mapRowToStats(row: any): InvoiceStats {
    const revenueByAsset: Record<string, number> = {};

    Object.entries(row.revenue_by_asset || {}).forEach(([assetCode, revenue]) => {
      revenueByAsset[assetCode] = Number(revenue);
    });

    return {
      total_invoices: Number(row.total_invoices),
      paid_invoices: Number(row.paid_invoices),
      pending_invoices: Number(row.pending_invoices),
      actionable_invoices: Number(row.actionable_invoices ?? row.pending_invoices),
      expired_invoices: Number(row.expired_invoices),
      revenue_by_asset: revenueByAsset,
    };
  }

  /**
   * Map database row to Invoice object
   */
  private mapRowToInvoice(row: any): Invoice {
    return {
      id: row.id,
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
      status: row.status,
      paymentTxHash: row.payment_tx_hash,
      payerPublicKey: row.payer_public_key,
      payerName: row.payer_name,
      payerEmail: row.payer_email,
      createdAt: row.created_at,
      paidAt: row.paid_at,
      cancelledAt: row.cancelled_at,
      settledAt: row.settled_at,
      settlementContext: row.settlement_context,
      priorStatus: row.prior_status,
      latePaymentWarningCode: row.late_payment_warning_code,
      expiresAt: row.expires_at,
      metadata: row.metadata,
    };
  }

  async countInvoices(): Promise<number> {
    const res = await this.db.query('SELECT COUNT(*) as count FROM invoices');
    return parseInt(res.rows[0]?.count || '0', 10);
  }
}

export default new InvoiceService();
