'use client';

import { useEffect, useState } from 'react';
import { invoiceApi } from '@/lib/api';
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

  const { invoices, stats } = dashboardDataFor(loaded, connected ? publicKey : null);
  const filteredInvoices = searchInvoices(invoices, searchQuery);
  const hasAnyInvoices = hasAnyInvoicesIn(stats);
  const revenueByAsset = revenueEntries(stats);

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

  const handleExportCSV = () => {
    const paidInvoices = exportableInvoices(filteredInvoices);
    if (paidInvoices.length === 0) {
      toast.error('No paid invoices to export');
      return;
    }
    downloadInvoiceCSV(paidInvoices as any);
    toast.success(`Exported ${paidInvoices.length} paid invoices to CSV`);
  };

  return (
    <div className="min-h-screen bg-logo-pattern relative">
      <div className="accent-blob accent-blob-1"></div>
      <div className="accent-blob accent-blob-2"></div>
      <header className="fixed top-0 left-0 right-0 z-50 premium-header border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-display text-xl tracking-tight text-[var(--ink)] hover:opacity-80 transition-opacity">
            Quittance
          </Link>
          <div className="flex items-center gap-3">
            {!connected ? (
              <WalletConnect />
            ) : (
              <UserProfile userWallet={publicKey} onDisconnect={() => {
                window.location.reload();
              }} />
            )}
            <Link href="/" className="btn btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden sm:inline">New Invoice</span>
            </Link>
          </div>
        </div>
      </header>

      <div className="pt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        {!connected || !publicKey ? (
          <div className="card text-center py-16 max-w-lg mx-auto">
            <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Connect your wallet</h2>
            <p className="text-gray-600 mb-6">
              The dashboard shows the Quittance invoices issued by your connected
              Freighter wallet. It never reads the rest of your wallet activity.
            </p>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="card">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-blue-600" />
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
                  <TrendingUp className="w-6 h-6 text-green-600" />
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
                  <FileText className="w-6 h-6 text-yellow-600" />
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
                <div className="w-12 h-12 bg-cyan-100 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-cyan-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Revenue</p>
                  {revenueByAsset.length > 0 ? (
                    <div className="space-y-1">
                      {revenueByAsset.map(([assetCode, revenue]) => (
                        <div key={assetCode} className="flex items-center gap-2">
                          <p className="text-2xl font-bold text-gray-900">
                            {Number(revenue).toFixed(2)}
                          </p>
                          <AssetLogo code={assetCode} size={20} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-gray-900">0.00</p>
                  )}
                </div>
              </div>
            </div>
          </div>
            )}

            <div className="flex gap-3 mb-4">
              <div className="card flex-1 mb-0">
                <input
                  type="text"
                  placeholder="Search invoices..."
                  className="input w-full"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button
                onClick={handleExportCSV}
                className="btn btn-primary flex items-center gap-2 whitespace-nowrap"
                disabled={filteredInvoices.filter(inv => inv.status === 'PAID').length === 0}
                title="Export paid invoices only"
              >
                <Download className="w-5 h-5" />
                <span className="hidden sm:inline">Export CSV</span>
              </button>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 mb-6 p-2 flex gap-2 flex-wrap">
              {['all', 'pending', 'paid', 'expired', 'cancelled'].map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                    filter === status
                      ? 'bg-cyan-500 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>

            {loadError ? (
              <ApiErrorState
                message={loadError}
                onRetry={() => setReloadKey((value) => value + 1)}
              />
            ) : loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-cyan-500" />
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="card text-center py-12">
                <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
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
                      : 'Create your first invoice and start accepting Stellar payments. Only Quittance invoices appear here.'}
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
                    <Plus className="w-5 h-5" />
                    Create Invoice
                  </Link>
                )}
              </div>
            ) : (
              <>
                {searchQuery && (
                  <div className="mb-4 text-sm text-gray-600">
                    Found {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredInvoices.map((invoice) => (
                    <InvoiceCard key={invoice.id} invoice={invoice as any} />
                  ))}
                </div>
              </>
            )}
          </>
          </>
        )}
      </div>

      </div>
    </div>
  );
}
