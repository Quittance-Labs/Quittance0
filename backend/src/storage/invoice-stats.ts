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

  return {
    total_invoices: invoices.length,
    paid_invoices: invoices.filter(invoice => invoice.status === 'PAID').length,
    pending_invoices: invoices.filter(invoice => invoice.status === 'PENDING').length,
    expired_invoices: invoices.filter(invoice => invoice.status === 'EXPIRED').length,
    revenue_by_asset: revenueByAsset,
  };
}
