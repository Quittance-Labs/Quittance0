'use client';

import { useEffect, useState } from 'react';
import { invoiceApi, describeApiError } from '@/lib/api';
import InvoiceCard from '@/components/InvoiceCard';
import WalletConnect from '@/components/WalletConnect';
import UserProfile from '@/components/UserProfile';
import AssetLogo from '@/components/AssetLogo';
import { useWalletStore } from '@/lib/store';
import Link from 'next/link';
import { Loader2, Plus, TrendingUp, DollarSign, FileText, Download } from 'lucide-react';
import { toast } from 'sonner';
import { downloadInvoiceCSV } from '@/lib/export';
import {
  dashboardDataFor,
  exportableInvoices,
  hasAnyInvoices as hasAnyInvoicesIn,
  revenueEntries,
  searchInvoices,
} from '@/lib/dashboard-history';
import ApiErrorState from '@/components/ApiErrorState';
import { apiErrorMessage } from '@/lib/api';
import { dashboardEmptyMessage } from '@/lib/dashboard-empty-copy';
import { DASHBOARD_RESULTS_ID, MAIN_CONTENT_ID, describeAmount, statusText } from '@/lib/a11y';

export default function DashboardPage() {
  const { publicKey, connected } = useWalletStore();
  // Loaded data is tagged with the wallet it belongs to, so a response for a
  // previous seller can never be rendered under the current one.
  const [loaded, setLoaded] = useState<{ owner: string | null; invoices: any[]; stats: any }>({
    owner: null,
    invoices: [],
    stats: null,
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [lifecycleNow, setLifecycleNow] = useState(() => Date.now());

  const { invoices, stats } = dashboardDataFor(
    loaded,
    connected ? publicKey : null,
    lifecycleNow
  );
  const filteredInvoices = searchInvoices(invoices, searchQuery);
  const hasAnyInvoices = hasAnyInvoicesIn(stats);
  const revenueByAsset = revenueEntries(stats);

  useEffect(() => {
    const timer = window.setInterval(() => setLifecycleNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!connected || !publicKey) {
      setLoaded({ owner: null, invoices: [], stats: null });
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const [invoicesResult, statsResult] = await Promise.all([
          invoiceApi.getAll({
            status: filter === 'all' ? undefined : filter.toUpperCase(),
            limit: 50,
            sellerPublicKey: publicKey,
          }),
          invoiceApi.getStats(publicKey),
        ]);

        if (!active) return;
        setLoaded({
          owner: publicKey,
          invoices: invoicesResult.data,
          stats: statsResult.data[0] || {},
        });
      } catch (error) {
        if (!active) return;
        const message = apiErrorMessage(error, 'Failed to load dashboard data');
        setLoadError(message);
        toast.error(message);
      } finally {
        if (active) setLoading(false);
      }
    })();

    // Switching wallets or unmounting invalidates the request in flight.
    return () => {
      active = false;
    };
  }, [filter, connected, publicKey, reloadKey]);

  const handleInvoiceCancelled = (cancelledId: string) => {
    setLoaded((prev) => {
      if (!prev.invoices) return prev;
      const updatedInvoices = prev.invoices.map((inv) =>
        inv.id === cancelledId ? { ...inv, status: 'CANCELLED' } : inv
      );
      return {
        ...prev,
        invoices: updatedInvoices,
        stats: prev.stats
          ? {
              ...prev.stats,
              pending_invoices: Math.max(0, Number(prev.stats.pending_invoices || 0) - 1),
            }
          : prev.stats,
      };
    });
    setReloadKey((k) => k + 1);
  };

  const handleExportCSV = () => {
    const paidInvoices = exportableInvoices(filteredInvoices);
    if (paidInvoices.length === 0) {
      toast.error('No paid invoices to export');
      return;
    }
    downloadInvoiceCSV(paidInvoices as any);
    toast.success(`Exported ${paidInvoices.length} paid invoices to CSV`);
  };

  const paidCount = filteredInvoices.filter((inv) => inv.status === 'PAID').length;
  const canExport = paidCount > 0;

  /*
   * One sentence describing the current result set, read by the live region
   * below (issue #289). Filtering and searching both replace the grid without
   * any page navigation, so without this a screen-reader user pressing
   * "Pending" gets no feedback that anything happened at all.
   */
  const resultsAnnouncement = (() => {
    if (loadError) return `Could not load your invoices. ${loadError}`;
    if (loading) return 'Loading your invoices.';
    const scope = filter === 'all' ? '' : ` ${statusText(filter).label.toLowerCase()}`;
    const suffix = searchQuery ? ` matching “${searchQuery}”` : '';
    if (filteredInvoices.length === 0) return `No${scope} invoices${suffix}.`;
    return `${filteredInvoices.length}${scope} invoice${
      filteredInvoices.length === 1 ? '' : 's'
    }${suffix}.`;
  })();

  return (
    <div className="min-h-screen bg-logo-pattern relative">
      <div className="accent-blob accent-blob-1"></div>
      <div className="accent-blob accent-blob-2"></div>
      <header className="fixed top-0 left-0 right-0 z-50 premium-header border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-display text-xl tracking-tight text-[var(--ink)] hover:opacity-80 transition-opacity">
            Quittance
          </Link>
          <nav className="flex items-center gap-3" aria-label="Main">
            {!connected ? (
              <WalletConnect />
            ) : (
              <UserProfile userWallet={publicKey} onDisconnect={() => {
                window.location.reload();
              }} />
            )}
            <Link href="/" className="btn btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" aria-hidden="true" />
              <span className="hidden sm:inline">New Invoice</span>
              <span className="sm:hidden sr-only">New Invoice</span>
            </Link>
          </nav>
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="pt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        <h1 className="sr-only">Invoice dashboard</h1>
        {!connected || !publicKey ? (
          <div className="card text-center py-16 max-w-lg mx-auto">
            <FileText className="w-16 h-16 text-gray-500 mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Connect your wallet</h2>
            <p className="text-gray-600 mb-6">{dashboardEmptyMessage(false)}</p>
            <div className="flex justify-center">
              <WalletConnect />
            </div>
          </div>
        ) : (
          <>
        {/*
          History is scoped to this seller's Quittance invoices. The dashboard
          deliberately does not read the wallet's Horizon payment feed: that
          would surface transfers unrelated to Quittance (issue #232).
        */}
        <>
            {stats && (
              <section aria-label="Invoice statistics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
            <div className="card">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-blue-700" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Invoices</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.total_invoices || 0}
                  </p>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-green-700" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Paid</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.paid_invoices || 0}
                  </p>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-yellow-800" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Pending</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.pending_invoices || 0}
                  </p>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Expired</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.expired_invoices || 0}
                  </p>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-cyan-100 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-cyan-700" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Revenue</p>
                  {revenueByAsset.length > 0 ? (
                    <div className="space-y-1">
                      {revenueByAsset.map(([assetCode, revenue]) => (
                        <p key={assetCode} className="flex items-center gap-2">
                          <span className="text-2xl font-bold text-gray-900" aria-hidden="true">
                            {Number(revenue).toFixed(2)}
                          </span>
                          <AssetLogo code={assetCode} size={20} decorative />
                          {/* The figure and the logo read as two values. */}
                          <span className="sr-only">
                            {describeAmount(Number(revenue).toFixed(2), assetCode)}
                          </span>
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-gray-900">0.00</p>
                  )}
                </div>
              </div>
            </div>
          </section>
            )}

            <div className="flex gap-3 mb-4">
              <div className="card flex-1 mb-0">
                <label htmlFor="invoice-search" className="sr-only">
                  Search invoices
                </label>
                <input
                  id="invoice-search"
                  // type="search" so the control is announced as a search field
                  // and gets the platform's clear affordance.
                  type="search"
                  placeholder="Search invoices..."
                  className="input w-full"
                  value={searchQuery}
                  aria-describedby={DASHBOARD_RESULTS_ID}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {/*
                aria-disabled rather than disabled, so the button keeps its tab
                stop and the reason for it being unavailable is announced.
              */}
              <button
                onClick={canExport ? handleExportCSV : undefined}
                className="btn btn-primary flex items-center gap-2 whitespace-nowrap"
                aria-disabled={!canExport}
                aria-describedby={canExport ? undefined : 'export-csv-reason'}
                aria-label="Export paid invoices to CSV"
              >
                <Download className="w-5 h-5" aria-hidden="true" />
                <span className="hidden sm:inline">Export CSV</span>
              </button>
              {!canExport && (
                <span id="export-csv-reason" className="sr-only">
                  Unavailable: there are no paid invoices in the current view.
                </span>
              )}
            </div>

            {/*
              Toggle buttons in a named group. aria-pressed carries the selected
              state, which was previously only a background colour.
            */}
            <div
              role="group"
              aria-label="Filter invoices by status"
              className="bg-white rounded-lg border border-gray-200 mb-6 p-2 flex gap-2 flex-wrap"
            >
              {['all', 'pending', 'paid', 'expired', 'cancelled'].map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  aria-pressed={filter === status}
                  className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                    filter === status
                      ? 'bg-cyan-700 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>

            <p
              id={DASHBOARD_RESULTS_ID}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={`mb-4 text-sm ${loadError ? 'text-red-700' : 'text-gray-600'}`}
            >
              {resultsAnnouncement}
            </p>

            {loadError ? (
              <ApiErrorState
                message={loadError}
                onRetry={() => setReloadKey((value) => value + 1)}
              />
            ) : loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-cyan-700" aria-hidden="true" />
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="card text-center py-12">
                <FileText className="w-16 h-16 text-gray-500 mx-auto mb-4" aria-hidden="true" />
                <h3 className="text-xl font-semibold text-gray-700 mb-2">
                  {searchQuery
                    ? 'No Matching Invoices'
                    : hasAnyInvoices
                      ? `No ${filter === 'all' ? '' : `${filter} `}Invoices`
                      : 'No Invoices Yet'}
                </h3>
                <p className="text-gray-600 mb-6">
                  {searchQuery
                    ? 'Try a different search term or clear your search.'
                    : hasAnyInvoices
                      ? 'Choose another status to see your other invoices.'
                      : dashboardEmptyMessage(true)}
                </p>
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="btn btn-primary"
                  >
                    Clear Search
                  </button>
                ) : hasAnyInvoices ? (
                  <button
                    type="button"
                    onClick={() => setFilter('all')}
                    className="btn btn-primary"
                  >
                    Show All Invoices
                  </button>
                ) : (
                  <Link href="/" className="btn btn-primary inline-flex items-center gap-2">
                    <Plus className="w-5 h-5" aria-hidden="true" />
                    Create Invoice
                  </Link>
                )}
              </div>
            ) : (
              /*
                The count that used to sit here is now in the live region above,
                which covers filtering too and not only searching.
              */
              <section aria-labelledby="invoice-list-heading">
                {/*
                  The cards below are h3s. Without this h2 the outline jumped
                  from the page's h1 straight to h3, which axe reports as
                  heading-order and which breaks heading-based navigation.
                */}
                <h2 id="invoice-list-heading" className="sr-only">
                  Invoices
                </h2>
                <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 list-none p-0">
                  {filteredInvoices.map((invoice) => (
                    <li key={invoice.id}>
                      <InvoiceCard
                        invoice={invoice as any}
                        userWallet={publicKey}
                        onCancel={handleInvoiceCancelled}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
          </>
        )}
      </div>

      </main>
    </div>
  );
}
