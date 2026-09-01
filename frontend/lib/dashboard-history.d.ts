export interface DashboardInvoice {
  id: string;
  memo: string;
  amount: number | string;
  status: string;
  expiresAt?: string | Date;
  sellerPublicKey: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  [key: string]: unknown;
}

export interface DashboardStats {
  total_invoices?: number;
  paid_invoices?: number;
  pending_invoices?: number;
  actionable_invoices?: number;
  expired_invoices?: number;
  revenue_by_asset?: Record<string, number | string>;
}

/** Data as loaded, tagged with the wallet it was loaded for. */
export interface OwnedDashboardData {
  owner: string | null;
  invoices: DashboardInvoice[];
  stats: DashboardStats | null;
}

export interface DashboardData {
  invoices: DashboardInvoice[];
  stats: DashboardStats | null;
}

export declare const INVOICE_FILTERS: readonly string[];

export function belongsToSeller(
  invoice: DashboardInvoice | null | undefined,
  sellerPublicKey: string | null | undefined
): boolean;

export function scopeInvoicesToSeller(
  invoices: DashboardInvoice[] | null | undefined,
  sellerPublicKey: string | null | undefined
): DashboardInvoice[];

export function invoiceSearchText(invoice: DashboardInvoice): string;

export function searchInvoices(
  invoices: DashboardInvoice[] | null | undefined,
  query: string | null | undefined
): DashboardInvoice[];

export function exportableInvoices(
  invoices: DashboardInvoice[] | null | undefined
): DashboardInvoice[];

export function actionableInvoices(
  invoices: DashboardInvoice[] | null | undefined,
  now?: string | number | Date
): DashboardInvoice[];

export function historicalInvoices(
  invoices: DashboardInvoice[] | null | undefined,
  now?: string | number | Date
): DashboardInvoice[];

export function isInvoiceCancellable(
  invoice: DashboardInvoice | null | undefined,
  sellerPublicKey?: string | null,
  now?: string | number | Date
): boolean;

export function emptyDashboardData(): DashboardData;

export function dashboardDataFor(
  data: OwnedDashboardData | null | undefined,
  sellerPublicKey: string | null | undefined,
  now?: string | number | Date
): DashboardData;

export function reconcileExpiryStats(
  stats: DashboardStats | null | undefined,
  originalInvoices: DashboardInvoice[],
  projectedInvoices: DashboardInvoice[]
): DashboardStats | null;

export function revenueEntries(
  stats: DashboardStats | null | undefined
): Array<[string, number | string]>;

export function hasAnyInvoices(stats: DashboardStats | null | undefined): boolean;
