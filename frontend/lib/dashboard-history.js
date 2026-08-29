/**
 * Dashboard history scoping (issue #232).
 *
 * PLAN.md scopes the dashboard to the connected seller's **invoices**. The
 * dashboard used to also embed a raw Horizon payment feed for the wallet,
 * which showed inbound and outbound transfers that have nothing to do with
 * Quittance — broader than invoice proof history, and at odds with the privacy
 * position that wallet activity beyond Quittance invoices is not inferred.
 *
 * These helpers are pure so the scoping rules can be tested without a wallet,
 * a backend or a browser.
 */

/** Invoice statuses the dashboard can filter by, plus the catch-all. */
const INVOICE_FILTERS = Object.freeze(['all', 'pending', 'paid', 'expired', 'cancelled']);

/**
 * Whether an invoice belongs to the connected seller.
 *
 * The backend already scopes its queries, so this is a second line of defence:
 * a response that arrives for a previous wallet must never be rendered under
 * the current one.
 */
function belongsToSeller(invoice, sellerPublicKey) {
  if (!invoice || !sellerPublicKey) return false;
  return invoice.sellerPublicKey === sellerPublicKey;
}

/** Drops anything that is not this seller's, preserving order. */
function scopeInvoicesToSeller(invoices, sellerPublicKey) {
  if (!Array.isArray(invoices) || !sellerPublicKey) return [];
  return invoices.filter((invoice) => belongsToSeller(invoice, sellerPublicKey));
}

/**
 * The searchable text of an invoice.
 *
 * Only fields the seller themselves supplied or can already see are searched;
 * nothing is derived from wallet activity.
 */
function invoiceSearchText(invoice) {
  return [
    invoice?.id,
    invoice?.memo,
    invoice?.description,
    invoice?.customerName,
    invoice?.customerEmail,
    invoice?.amount,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(' ')
    .toLowerCase();
}

function searchInvoices(invoices, query) {
  const needle = (query ?? '').trim().toLowerCase();
  if (!needle) return Array.isArray(invoices) ? [...invoices] : [];
  if (!Array.isArray(invoices)) return [];

  return invoices.filter((invoice) => invoiceSearchText(invoice).includes(needle));
}

/** Paid invoices are the only ones worth exporting as settled history. */
function exportableInvoices(invoices) {
  if (!Array.isArray(invoices)) return [];
  return invoices.filter((invoice) => invoice?.status === 'PAID');
}

/** The empty dashboard, used on disconnect and on every wallet switch. */
function emptyDashboardData() {
  return { invoices: [], stats: null };
}

/**
 * Decides what the dashboard should render for a given wallet.
 *
 * Returning empty data whenever the wallet does not match is what stops the
 * previous seller's invoices from staying on screen while the next seller's
 * request is still in flight.
 */
function dashboardDataFor(data, sellerPublicKey) {
  if (!sellerPublicKey || !data || data.owner !== sellerPublicKey) {
    return emptyDashboardData();
  }

  return {
    invoices: scopeInvoicesToSeller(data.invoices, sellerPublicKey),
    stats: data.stats ?? null,
  };
}

/** Sorted revenue pairs. Revenue is never summed across assets. */
function revenueEntries(stats) {
  const revenue = stats?.revenue_by_asset;
  if (!revenue || typeof revenue !== 'object') return [];

  return Object.entries(revenue).sort(([assetA], [assetB]) => assetA.localeCompare(assetB));
}

function hasAnyInvoices(stats) {
  return Number(stats?.total_invoices || 0) > 0;
}

module.exports = {
  INVOICE_FILTERS,
  belongsToSeller,
  scopeInvoicesToSeller,
  invoiceSearchText,
  searchInvoices,
  exportableInvoices,
  emptyDashboardData,
  dashboardDataFor,
  revenueEntries,
  hasAnyInvoices,
};
