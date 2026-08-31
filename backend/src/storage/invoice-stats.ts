// Projection of StoredInvoice used by the dashboard stats aggregator. Uses a
// strict subset of StoredInvoice fields so both storage backends can feed the
// same pure calculateInvoiceStats helper without re-mapping types — the memory
// backend passes raw invoices, the Postgres backend maps a COUNT/SUM row to
// this shape.  Keeps sellerPublicKey, amount, assetCode, status in the same
// casing as StoredInvoice to avoid silent rename bugs.
import { isPendingInvoice } from '../utils/stats-pending-filter';

export interface StatsInvoice {
  sellerPublicKey: string;
  amount: number;
  assetCode: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
}

export interface InvoiceStats {
  total_invoices: number;
  paid_invoices: number;
  pending_invoices: number;
  actionable_invoices: number;
  expired_invoices: number;
  revenue_by_asset: Record<string, number>;
}

export function calculateInvoiceStats(
  allInvoices: StatsInvoice[],
  sellerPublicKey: string
): InvoiceStats {
  const invoices = allInvoices.filter(
    invoice => invoice.sellerPublicKey === sellerPublicKey
  );
  const revenueByAsset: Record<string, number> = {};

  invoices
    .filter(invoice => invoice.status === 'PAID')
    .forEach((invoice) => {
      const currentRevenue = Object.prototype.hasOwnProperty.call(
        revenueByAsset,
        invoice.assetCode
      )
        ? revenueByAsset[invoice.assetCode]
        : 0;
      revenueByAsset[invoice.assetCode] = currentRevenue + invoice.amount;
    });

  const pendingInvoices = invoices.filter(isPendingInvoice).length;

  return {
    total_invoices: invoices.length,
    paid_invoices: invoices.filter(invoice => invoice.status === 'PAID').length,
    pending_invoices: pendingInvoices,
    actionable_invoices: pendingInvoices,
    expired_invoices: invoices.filter(invoice => invoice.status === 'EXPIRED').length,
    revenue_by_asset: revenueByAsset,
  };
}
