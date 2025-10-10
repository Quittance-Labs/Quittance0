'use client';

import { useEffect, useState } from 'react';
import { invoiceApi } from '@/lib/api';
import InvoiceCard from '@/components/InvoiceCard';
import WalletConnect from '@/components/WalletConnect';
import Link from 'next/link';
import { Loader2, Plus, TrendingUp, DollarSign, FileText } from 'lucide-react';
import { toast } from 'sonner';

export default function DashboardPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    loadData();
  }, [filter]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      const [invoicesResult, statsResult] = await Promise.all([
        invoiceApi.getAll({
          status: filter === 'all' ? undefined : filter.toUpperCase(),
          limit: 50,
        }),
        invoiceApi.getStats(),
      ]);

      setInvoices(invoicesResult.data);
      setStats(statsResult.data[0] || {});
    } catch (error) {
      toast.error('Failed to load dashboard data');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <div className="flex items-center gap-3">
            <WalletConnect />
            <Link href="/" className="btn btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden sm:inline">New Invoice</span>
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="card">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
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
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
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
                <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
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
                <div className="w-12 h-12 bg-stellar-100 rounded-full flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-stellar-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Revenue</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {parseFloat(stats.total_revenue || 0).toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-500">{stats.asset_code || 'XLM'}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="bg-white rounded-lg border mb-6 p-2 flex gap-2">
          {['all', 'pending', 'paid', 'expired'].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === status
                  ? 'bg-stellar-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Invoices List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-12 h-12 animate-spin text-stellar-600" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="card text-center py-12">
            <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-700 mb-2">
              No Invoices Found
            </h3>
            <p className="text-gray-600 mb-6">
              Create your first invoice to get started
            </p>
            <Link href="/" className="btn btn-primary">
              Create Invoice
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {invoices.map((invoice) => (
              <InvoiceCard key={invoice.id} invoice={invoice} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

